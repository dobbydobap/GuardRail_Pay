// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract AgentRegistry {
    struct AgentInfo {
        string name;
        bool registered;
        bool frozen;
        uint256 suspiciousCount;
    }

    struct RecipientInfo {
        string role;
        bool registered;
        bool allowed;
    }

    address public owner;
    address public vault;
    uint256 public freezeThreshold = 3;

    mapping(address => AgentInfo) public agents;
    mapping(address => RecipientInfo) public recipients;

    event AgentRegistered(address indexed agent, string name);
    event RecipientRegistered(address indexed recipient, string role);
    event RecipientAllowedSet(address indexed recipient, bool allowed);
    event SuspiciousIncremented(address indexed agent, uint256 count);
    event AgentFrozen(address indexed agent);
    event VaultSet(address indexed vault);

    modifier onlyOwner() {
        require(msg.sender == owner, "ONLY_OWNER");
        _;
    }

    modifier onlyOwnerOrVault() {
        require(msg.sender == owner || msg.sender == vault, "ONLY_OWNER_OR_VAULT");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function setVault(address vault_) external onlyOwner {
        require(vault_ != address(0), "ZERO_VAULT");
        vault = vault_;
        emit VaultSet(vault_);
    }

    function setFreezeThreshold(uint256 threshold) external onlyOwner {
        require(threshold > 0, "BAD_THRESHOLD");
        freezeThreshold = threshold;
    }

    function registerAgent(address agent, string memory name) external onlyOwner {
        require(agent != address(0), "ZERO_AGENT");
        agents[agent].name = name;
        agents[agent].registered = true;
        emit AgentRegistered(agent, name);
    }

    function registerRecipient(address recipient, string memory role) external onlyOwner {
        require(recipient != address(0), "ZERO_RECIPIENT");
        recipients[recipient] = RecipientInfo({
            role: role,
            registered: true,
            allowed: true
        });
        emit RecipientRegistered(recipient, role);
        emit RecipientAllowedSet(recipient, true);
    }

    function setRecipientAllowed(address recipient, bool allowed) external onlyOwner {
        require(recipients[recipient].registered, "RECIPIENT_NOT_REGISTERED");
        recipients[recipient].allowed = allowed;
        emit RecipientAllowedSet(recipient, allowed);
    }

    function incrementSuspicious(address agent) external onlyOwnerOrVault {
        require(agents[agent].registered, "AGENT_NOT_REGISTERED");
        agents[agent].suspiciousCount += 1;
        emit SuspiciousIncremented(agent, agents[agent].suspiciousCount);

        if (agents[agent].suspiciousCount >= freezeThreshold && !agents[agent].frozen) {
            agents[agent].frozen = true;
            emit AgentFrozen(agent);
        }
    }

    function isAllowedRecipient(address recipient) external view returns (bool) {
        return recipients[recipient].registered && recipients[recipient].allowed;
    }

    function isFrozen(address agent) external view returns (bool) {
        return agents[agent].frozen;
    }

    function isRegisteredAgent(address agent) external view returns (bool) {
        return agents[agent].registered;
    }
}
