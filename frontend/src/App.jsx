import { useState } from 'react'
import GuardRail from './GuardRail'
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, ResponsiveContainer, Tooltip,
} from 'recharts'

const lineData = [
  { m: 'Jan', a: 12, b: 8 }, { m: 'Feb', a: 9, b: 18 }, { m: 'Mar', a: 11, b: 14 },
  { m: 'Apr', a: 15, b: 9 }, { m: 'May', a: 20, b: 13 }, { m: 'Jun', a: 18, b: 22 },
  { m: 'Jul', a: 23, b: 27 },
]
const deviceData = [
  { name: 'Linux', v: 18, c: '#a8c5da' }, { name: 'Mac', v: 30, c: '#5ce0b0' },
  { name: 'iOS', v: 21, c: '#1c1c1c' }, { name: 'Windows', v: 34, c: '#95a4fc' },
  { name: 'Android', v: 13, c: '#c9b8f0' }, { name: 'Other', v: 27, c: '#7fd99a' },
]
const projData = [
  { m: 'Jan', v: 16, c: '#a8c5da' }, { m: 'Feb', v: 22, c: '#5ce0b0' },
  { m: 'Mar', v: 20, c: '#1c1c1c' }, { m: 'Apr', v: 26, c: '#95a4fc' },
  { m: 'May', v: 12, c: '#c9b8f0' }, { m: 'Jun', v: 23, c: '#7fd99a' },
]
const locData = [
  { name: 'United States', v: 52.1, c: '#1c1c1c' },
  { name: 'Canada', v: 22.8, c: '#a8c5da' },
  { name: 'Mexico', v: 13.9, c: '#95a4fc' },
  { name: 'Other', v: 11.2, c: '#7fd99a' },
]
const traffic = [
  ['Google', 0.4], ['YouTube', 0.7], ['Instagram', 0.35], ['Pinterest', 0.9],
  ['Facebook', 0.3], ['Twitter', 0.45],
]
const products = [
  ['ASOS Ridley High Waist', '$79.49', 82, '$6,518.18'],
  ['Marco Lightweight Shirt', '$128.50', 37, '$4,754.50'],
  ['Half Sleeve Shirt', '$39.99', 64, '$2,559.36'],
  ['Lightweight Jacket', '$20.00', 184, '$3,680.00'],
  ['Marco Shoes', '$79.49', 64, '$1,965.81'],
]
const revLoc = [['New York', 72], ['San Francisco', 39], ['Sydney', 25], ['Singapore', 61]]

const notifications = [
  ['You fixed a bug.', 'Just now'], ['New user registered.', '59 minutes ago'],
  ['You fixed a bug.', '12 hours ago'], ['Andi Lane subscribed to you.', 'Today, 11:59 AM'],
]
const activities = [
  ['Changed the style.', 'Just now'], ['Released a new version.', '59 minutes ago'],
  ['Submitted a bug.', '12 hours ago'], ['Modified A data in Page X.', 'Today, 11:59 AM'],
  ['Deleted a page in Project X.', 'Feb 2, 2026'],
]
const contacts = ['Natali Craig', 'Drew Cano', 'Andi Lane', 'Koray Okumus', 'Kate Morrison', 'Melody Macy']

function Stat({ title, num, delta, up, bg }) {
  return (
    <div className="stat" style={{ background: bg }}>
      <h4>{title}</h4>
      <div className="row">
        <span className="num">{num}</span>
        <span className="delta">{delta} {up ? '↗' : '↘'}</span>
      </div>
    </div>
  )
}

function Sidebar({ page, setPage }) {
  const items = [
    ['Overview', 'overview'], ['eCommerce', 'ecommerce'], ['GuardRail Pay', 'guardrail'],
  ]
  return (
    <aside className="sidebar">
      <div className="brand"><span className="avatar" /> ByeWind</div>
      <div className="nav-tabs"><span className="active">Favorites</span><span>Recently</span></div>
      <div className="nav-item">Overview</div>
      <div className="nav-item">Projects</div>

      <div className="nav-section">Dashboards</div>
      {items.map(([label, key]) => (
        <div key={key} className={'nav-item' + (page === key ? ' active' : '')} onClick={() => setPage(key)}>
          <span className="ico">▣</span> {label}
        </div>
      ))}

      <div className="nav-section">Pages</div>
      {['User Profile', 'Account', 'Corporate', 'Blog', 'Social'].map((p) => (
        <div key={p} className="nav-item"><span className="ico">▢</span> {p}</div>
      ))}
    </aside>
  )
}

function RightBar() {
  return (
    <aside className="rightbar">
      <h3>Notifications</h3>
      {notifications.map(([t, time], i) => (
        <div className="feed-item" key={i}>
          <span className="dot" />
          <div><div className="t">{t}</div><div className="time">{time}</div></div>
        </div>
      ))}
      <h3>Activities</h3>
      {activities.map(([t, time], i) => (
        <div className="feed-item" key={i}>
          <span className="av" />
          <div><div className="t">{t}</div><div className="time">{time}</div></div>
        </div>
      ))}
      <h3>Contacts</h3>
      {contacts.map((c) => (
        <div className="contact" key={c}><span className="av" /> {c}</div>
      ))}
    </aside>
  )
}

function Overview() {
  return (
    <>
      <h2 className="page-title">Overview</h2>
      <div className="cards">
        <Stat title="Views" num="7,265" delta="+11.01%" up bg="#e3f5ff" />
        <Stat title="Visits" num="3,671" delta="-0.03%" bg="#e5ecf6" />
        <Stat title="New Users" num="256" delta="+15.03%" up bg="#e3f5ff" />
        <Stat title="Active Users" num="2,318" delta="+6.08%" up bg="#e5ecf6" />
      </div>

      <div className="charts">
        <div className="panel">
          <h3>Total Users</h3>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={lineData}>
              <XAxis dataKey="m" axisLine={false} tickLine={false} />
              <YAxis axisLine={false} tickLine={false} width={30} />
              <Tooltip />
              <Area type="monotone" dataKey="a" stroke="#1c1c1c" fill="#1c1c1c10" strokeWidth={2} />
              <Line type="monotone" dataKey="b" stroke="#95a4fc" strokeDasharray="4 4" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="panel">
          <h3>Traffic by Website</h3>
          {traffic.map(([name, v]) => (
            <div className="traffic-row" key={name}>
              <span>{name}</span>
              <div className="bar-track"><div className="bar" style={{ width: `${v * 120}px` }} /></div>
            </div>
          ))}
        </div>
      </div>

      <div className="charts even">
        <div className="panel">
          <h3>Traffic by Device</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={deviceData}>
              <XAxis dataKey="name" axisLine={false} tickLine={false} />
              <YAxis axisLine={false} tickLine={false} width={30} />
              <Tooltip cursor={{ fill: '#0000000a' }} />
              <Bar dataKey="v" radius={[6, 6, 6, 6]}>
                {deviceData.map((d, i) => <Cell key={i} fill={d.c} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="panel">
          <h3>Traffic by Location</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <ResponsiveContainer width="50%" height={180}>
              <PieChart>
                <Pie data={locData} dataKey="v" innerRadius={45} outerRadius={70} paddingAngle={2}>
                  {locData.map((d, i) => <Cell key={i} fill={d.c} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div style={{ flex: 1 }}>
              {locData.map((d) => (
                <div className="loc-row" key={d.name}>
                  <span>● {d.name}</span><span>{d.v}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

function Ecommerce() {
  return (
    <>
      <h2 className="page-title">eCommerce</h2>
      <div className="charts">
        <div>
          <div className="cards" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <Stat title="Views" num="3,781" delta="+11.01%" up bg="#e3f5ff" />
            <Stat title="Customers" num="1,219" delta="-0.03%" bg="#f7f9fb" />
            <Stat title="Orders" num="316" delta="+6.08%" up bg="#f7f9fb" />
            <Stat title="Revenue" num="$695" delta="+15.03%" up bg="#e5ecf6" />
          </div>
        </div>
        <div className="panel">
          <h3>Projections vs Actuals</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={projData}>
              <XAxis dataKey="m" axisLine={false} tickLine={false} />
              <YAxis axisLine={false} tickLine={false} width={30} />
              <Tooltip cursor={{ fill: '#0000000a' }} />
              <Bar dataKey="v" radius={[6, 6, 0, 0]}>
                {projData.map((d, i) => <Cell key={i} fill={d.c} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="charts">
        <div className="panel">
          <h3>Revenue &nbsp; <small style={{ color: 'var(--muted)' }}>● Current $58,211 &nbsp; ● Previous $68,768</small></h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={lineData}>
              <XAxis dataKey="m" axisLine={false} tickLine={false} />
              <YAxis axisLine={false} tickLine={false} width={30} />
              <Tooltip />
              <Line type="monotone" dataKey="a" stroke="#1c1c1c" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="b" stroke="#a8c5da" strokeDasharray="4 4" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="panel">
          <h3>Revenue by Location</h3>
          {revLoc.map(([city, v]) => (
            <div key={city} style={{ margin: '14px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>{city}</span><span>{v}K</span>
              </div>
              <div className="loc-bar" style={{ width: `${v}%` }} />
            </div>
          ))}
        </div>
      </div>

      <div className="charts">
        <div className="panel">
          <h3>Top Selling Products</h3>
          <table>
            <thead><tr><th>Name</th><th>Price</th><th>Quantity</th><th>Amount</th></tr></thead>
            <tbody>
              {products.map((p, i) => (
                <tr key={i}><td>{p[0]}</td><td>{p[1]}</td><td>{p[2]}</td><td>{p[3]}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel">
          <h3>Total Sales</h3>
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie data={locData} dataKey="v" innerRadius={45} outerRadius={70} paddingAngle={2}>
                {locData.map((d, i) => <Cell key={i} fill={d.c} />)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="loc-row"><span>● Direct</span><span>$300.56</span></div>
          <div className="loc-row"><span>● Affiliate</span><span>$135.18</span></div>
          <div className="loc-row"><span>● Sponsored</span><span>$154.02</span></div>
          <div className="loc-row"><span>● E-mail</span><span>$48.96</span></div>
        </div>
      </div>
    </>
  )
}

export default function App() {
  const [page, setPage] = useState('overview')
  return (
    <div className="app">
      <Sidebar page={page} setPage={setPage} />
      <main className="main">
        <div className="topbar">
          <div className="crumbs">Dashboards / <b>{page === 'ecommerce' ? 'eCommerce' : page === 'guardrail' ? 'GuardRail Pay' : 'Default'}</b></div>
          <input className="search" placeholder="Search" />
        </div>
        {page === 'ecommerce' ? <Ecommerce /> : page === 'guardrail' ? <GuardRail /> : <Overview />}
      </main>
      <RightBar />
    </div>
  )
}
