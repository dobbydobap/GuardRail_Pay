// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IAgentRegistry {
    function incrementSuspicious(address agent) external;
    function isAllowedRecipient(address recipient) external view returns (bool);
    function isFrozen(address agent) external view returns (bool);
    function isRegisteredAgent(address agent) external view returns (bool);
}

contract AgentVault {
    struct Escrow {
        address agent;
        address payable verifier;
        uint256 amount;
        bool approved;
        bool released;
        string reason;
    }

    IAgentRegistry public immutable registry;
    address public owner;
    uint256 public maxPerPayment;
    uint256 public dailyLimit;

    mapping(address => uint256) public balances;
    mapping(address => mapping(uint256 => uint256)) public dailySpend;
    mapping(bytes32 => Escrow) public escrows;

    event Deposited(address indexed agent, uint256 amount);
    event PaymentApproved(
        bytes32 indexed taskId,
        address indexed agent,
        address indexed to,
        uint256 amount,
        string actionType,
        string reason
    );
    event PaymentBlocked(
        bytes32 indexed taskId,
        address indexed agent,
        address indexed to,
        uint256 amount,
        string blockReason
    );
    event EscrowCreated(
        bytes32 indexed taskId,
        address indexed agent,
        address indexed verifier,
        uint256 amount,
        string reason
    );
    event EscrowApproved(bytes32 indexed taskId, address indexed verifier);
    event EscrowReleased(bytes32 indexed taskId, address indexed verifier, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "ONLY_OWNER");
        _;
    }

    constructor(address registry_, uint256 maxPerPayment_, uint256 dailyLimit_) {
        require(registry_ != address(0), "ZERO_REGISTRY");
        require(maxPerPayment_ > 0, "BAD_MAX");
        require(dailyLimit_ >= maxPerPayment_, "BAD_DAILY");

        registry = IAgentRegistry(registry_);
        owner = msg.sender;
        maxPerPayment = maxPerPayment_;
        dailyLimit = dailyLimit_;
    }

    receive() external payable {
        deposit();
    }

    function setLimits(uint256 maxPerPayment_, uint256 dailyLimit_) external onlyOwner {
        require(maxPerPayment_ > 0, "BAD_MAX");
        require(dailyLimit_ >= maxPerPayment_, "BAD_DAILY");
        maxPerPayment = maxPerPayment_;
        dailyLimit = dailyLimit_;
    }

    function deposit() public payable {
        require(msg.value > 0, "NO_VALUE");
        require(registry.isRegisteredAgent(msg.sender), "AGENT_NOT_REGISTERED");
        balances[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    function requestPayment(
        bytes32 taskId,
        address agent,
        address payable to,
        uint256 amount,
        string memory actionType,
        string memory reason
    ) external {
        require(msg.sender == agent, "ONLY_AGENT");

        string memory blockReason = _policyBlockReason(agent, to, amount, reason);
        if (bytes(blockReason).length != 0) {
            registry.incrementSuspicious(agent);
            emit PaymentBlocked(taskId, agent, to, amount, blockReason);
            return;
        }

        balances[agent] -= amount;
        dailySpend[agent][_currentDay()] += amount;

        (bool sent, ) = to.call{value: amount}("");
        require(sent, "PAYMENT_FAILED");

        emit PaymentApproved(taskId, agent, to, amount, actionType, reason);
    }

    function createEscrow(
        bytes32 taskId,
        address agent,
        address payable verifier,
        uint256 amount,
        string memory reason
    ) external {
        require(msg.sender == agent, "ONLY_AGENT");
        require(escrows[taskId].agent == address(0), "ESCROW_EXISTS");

        string memory blockReason = _policyBlockReason(agent, verifier, amount, reason);
        if (bytes(blockReason).length != 0) {
            registry.incrementSuspicious(agent);
            emit PaymentBlocked(taskId, agent, verifier, amount, blockReason);
            return;
        }

        balances[agent] -= amount;
        dailySpend[agent][_currentDay()] += amount;
        escrows[taskId] = Escrow({
            agent: agent,
            verifier: verifier,
            amount: amount,
            approved: false,
            released: false,
            reason: reason
        });

        emit EscrowCreated(taskId, agent, verifier, amount, reason);
    }

    function approveEscrow(bytes32 taskId) external {
        Escrow storage escrow = escrows[taskId];
        require(escrow.agent != address(0), "ESCROW_NOT_FOUND");
        require(msg.sender == escrow.verifier, "ONLY_VERIFIER");
        require(!escrow.approved, "ALREADY_APPROVED");
        require(!escrow.released, "ALREADY_RELEASED");

        escrow.approved = true;
        emit EscrowApproved(taskId, msg.sender);
    }

    function releaseEscrow(bytes32 taskId) external {
        Escrow storage escrow = escrows[taskId];
        require(escrow.agent != address(0), "ESCROW_NOT_FOUND");
        require(msg.sender == escrow.verifier || msg.sender == escrow.agent, "ONLY_PARTICIPANT");
        require(escrow.approved, "NOT_APPROVED");
        require(!escrow.released, "ALREADY_RELEASED");

        escrow.released = true;
        uint256 amount = escrow.amount;

        (bool sent, ) = escrow.verifier.call{value: amount}("");
        require(sent, "ESCROW_PAYMENT_FAILED");

        emit EscrowReleased(taskId, escrow.verifier, amount);
    }

    function _policyBlockReason(
        address agent,
        address recipient,
        uint256 amount,
        string memory reason
    ) internal view returns (string memory) {
        if (!registry.isRegisteredAgent(agent)) return "AGENT_NOT_REGISTERED";
        if (registry.isFrozen(agent)) return "AGENT_FROZEN";
        if (!registry.isAllowedRecipient(recipient)) return "RECIPIENT_NOT_ALLOWED";
        if (amount == 0) return "ZERO_AMOUNT";
        if (amount > maxPerPayment) return "MAX_PER_PAYMENT_EXCEEDED";
        if (dailySpend[agent][_currentDay()] + amount > dailyLimit) return "DAILY_LIMIT_EXCEEDED";
        if (balances[agent] < amount) return "INSUFFICIENT_AGENT_BALANCE";
        if (_hasSuspiciousPhrase(reason)) return "ON_CHAIN_INJECTION_PATTERN";
        return "";
    }

    function _currentDay() internal view returns (uint256) {
        return block.timestamp / 1 days;
    }

    function _hasSuspiciousPhrase(string memory reason) internal pure returns (bool) {
        bytes memory lowerReason = _lower(bytes(reason));
        return _contains(lowerReason, bytes("ignore previous"))
            || _contains(lowerReason, bytes("transfer all"))
            || _contains(lowerReason, bytes("override policy"))
            || _contains(lowerReason, bytes("send everything"))
            || _contains(lowerReason, bytes("bypass"));
    }

    function _lower(bytes memory input) internal pure returns (bytes memory) {
        bytes memory output = new bytes(input.length);
        for (uint256 i = 0; i < input.length; i++) {
            bytes1 char = input[i];
            if (char >= 0x41 && char <= 0x5A) {
                output[i] = bytes1(uint8(char) + 32);
            } else {
                output[i] = char;
            }
        }
        return output;
    }

    function _contains(bytes memory haystack, bytes memory needle) internal pure returns (bool) {
        if (needle.length == 0 || needle.length > haystack.length) return false;
        for (uint256 i = 0; i <= haystack.length - needle.length; i++) {
            bool found = true;
            for (uint256 j = 0; j < needle.length; j++) {
                if (haystack[i + j] != needle[j]) {
                    found = false;
                    break;
                }
            }
            if (found) return true;
        }
        return false;
    }
}
