import { useEffect, useMemo, useState } from 'react';
import AnimatedContent from './react-bits/AnimatedContent.jsx';
import Noise from './react-bits/Noise.jsx';
import CountUp from './react-bits/CountUp.jsx';
import Topography from './react-bits/Topography.jsx';
import SplitText from './react-bits/SplitText.jsx';
import BlurText from './react-bits/BlurText.jsx';
import Magnet from './react-bits/Magnet.jsx';
import ClickSpark from './react-bits/ClickSpark.jsx';
import Dock from './react-bits/Dock.jsx';
import TiltedCard from './react-bits/TiltedCard.jsx';
import GradualBlur from './react-bits/GradualBlur.jsx';
import Notes from './Notes.jsx';

const api = window.ranch;

const CREAM = '#efe8d4';
const GREEN = '#5cb84a';

const fmtSize = (bytes) => (bytes ? `${Math.round(bytes / 1048576)} MB` : null);
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null);

/** A word or two describing where an app stands. */
function statusOf(a) {
  if (a.comingSoon) return 'Coming soon';
  if (a.busy === 'downloading') return 'Downloading';
  if (a.busy === 'finishing') return 'Installing';
  if (a.busy === 'uninstalling') return 'Uninstalling';
  if (a.error) return 'Needs attention';
  if (!a.installed) return 'Not installed';
  if (a.updateAvailable && a.updateReady && a.running) return 'Update ready';
  if (a.updateAvailable) return 'Update available';
  if (a.running) return 'Running';
  return 'Installed';
}

function primaryAction(a) {
  if (a.comingSoon) return { label: 'Not released yet', disabled: true };
  if (a.busy) return { label: a.busy === 'uninstalling' ? 'Uninstalling' : 'Working', disabled: true };
  if (!a.installed) return { label: 'Install', run: () => api.install(a.id) };
  if (a.updateAvailable) return { label: a.updateReady && a.running ? 'Update now' : `Update to ${a.latest}`, run: () => api.install(a.id) };
  return { label: a.running ? 'Show' : 'Play', run: () => api.open(a.id), open: true };
}

function Progress({ a }) {
  const known = a.progress != null;
  const label = a.busy === 'downloading' ? `Downloading ${a.latest}` : a.busy === 'finishing' ? 'Installing' : 'Uninstalling';
  return (
    <div className="progress">
      <div className="progress-head">
        <span>{label}</span>
        {known && <span className="progress-num"><CountUp to={a.progress} duration={0.35} trigger="load" />%</span>}
      </div>
      <div className={`progress-track${known ? '' : ' indeterminate'}`}>
        <i style={{ width: known ? `${a.progress}%` : undefined }} />
      </div>
    </div>
  );
}

const versionAtLeast = (v, min) => {
  const x = String(v || '0').split('.').map(Number);
  const y = min.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return true;
};

/** The app's own settings, saved straight into its settings file. */
function AppSettings({ a }) {
  const [data, setData] = useState(null);
  const [saved, setSaved] = useState('');
  const [drafts, setDrafts] = useState({});

  useEffect(() => { api.appSettings(a.id).then(setData); }, [a.id]);
  // Changed in the app itself? Show the new values (but don't disturb a box you're typing in)
  useEffect(() => api.onAppSettingsChanged(async (id) => {
    if (id !== a.id) return;
    setData(await api.appSettings(a.id));
    const typing = document.activeElement && document.activeElement.classList.contains('text-input');
    if (!typing) setDrafts({});
  }), [a.id]);

  const live = !a.running || versionAtLeast(a.version, '1.1.6');
  const confirm = () => setSaved(live
    ? `Saved. ${a.name} uses it right away.`
    : `Saved. ${a.name} uses it the next time you open it.`);
  const save = async (patch) => { setData(await api.setAppSettings(a.id, patch)); confirm(); };

  if (!data) return <p className="note">Loading settings</p>;
  return (
    <div className="app-settings">
      {!data.exists && <p className="note">{a.name} hasn't saved any settings on this PC yet, so these are its defaults.</p>}
      {data.items.map((s, i) => {
        if (s.group) return <h3 key={`g${i}`} className="group-title">{s.group}</h3>;
        if (s.type === 'toggle') {
          return (
            <label key={s.key} className="setting-row">
              <span><strong>{s.label}</strong><small>{s.help}</small></span>
              <input type="checkbox" className="switch" checked={!!s.value} onChange={(e) => save({ [s.key]: e.target.checked })} />
            </label>
          );
        }
        const draft = drafts[s.key] ?? String(s.value ?? '');
        const valid = !s.pattern || new RegExp(s.pattern).test(draft.trim());
        const commit = () => { if (valid && draft.trim() !== String(s.value ?? '')) save({ [s.key]: draft }); };
        return (
          <label key={s.key} className="setting-row setting-text">
            <span><strong>{s.label}</strong><small>{s.help}</small></span>
            <input type="text" className={`text-input${valid ? '' : ' is-invalid'}`} value={draft} placeholder={s.placeholder}
              spellCheck={false} onChange={(e) => setDrafts({ ...drafts, [s.key]: e.target.value })}
              onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
          </label>
        );
      })}
      <p className="saved" aria-live="polite">{saved}</p>
    </div>
  );
}

function AppPage({ a }) {
  const [tab, setTab] = useState('overview');
  const hasSettings = !a.comingSoon && a.installed;
  const action = primaryAction(a);
  const facts = [];
  if (a.installed) facts.push(['Installed', a.version]);
  if (a.latest) facts.push(['Latest', a.latest]);
  if (a.publishedAt) facts.push(['Released', fmtDate(a.publishedAt)]);
  if (a.size && !a.comingSoon) facts.push(['Size', fmtSize(a.size)]);

  return (
    <AnimatedContent key={a.id} trigger="mount" distance={24} duration={0.55} ease="power3.out" className="page app-page">
      <section className="hero">
        <p className="kicker">{statusOf(a)}</p>
        <SplitText key={`t-${a.id}`} text={a.name} tag="h1" className="title" splitType="chars" delay={28}
          duration={0.7} ease="power3.out" textAlign="left" effect="rise" trigger="view" threshold={0} rootMargin="0px" />
        <BlurText key={`d-${a.id}`} text={a.tagline} className="tagline" animateBy="words" delay={35}
          stepDuration={0.3} blur={8} distance={10} trigger="view" threshold={0} />

        {hasSettings && (
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'overview'} className={tab === 'overview' ? 'is-on' : ''} onClick={() => setTab('overview')}>Overview</button>
            <button role="tab" aria-selected={tab === 'settings'} className={tab === 'settings' ? 'is-on' : ''} onClick={() => setTab('settings')}>Settings</button>
          </div>
        )}

        {tab === 'settings' && hasSettings ? (
          <AnimatedContent key="app-settings" trigger="mount" distance={12} duration={0.4} ease="power2.out">
            <AppSettings a={a} />
          </AnimatedContent>
        ) : (<>
        <div className="actions">
          <ClickSpark sparkColor={CREAM} sparkSize={9} sparkRadius={22} sparkCount={7} duration={420} disabled={!!action.disabled}>
            <Magnet padding={46} magnetStrength={4} maxOffset={8} disabled={!!action.disabled}>
              <button className={`btn${action.open ? ' btn-open' : ''}`} disabled={action.disabled} onClick={action.run}>
                {action.label}
              </button>
            </Magnet>
          </ClickSpark>
          {a.repo && <button className="link" onClick={() => api.github(a.id)}>Releases</button>}
          {a.installed && !a.updateAvailable && !a.busy && <button className="link" onClick={() => api.install(a.id)}>Reinstall</button>}
          {a.installed && !a.busy && <button className="link link-danger" onClick={() => api.uninstall(a.id)}>Uninstall</button>}
        </div>

        {a.busy && <Progress a={a} />}
        {a.error && <p className="error">{a.error}</p>}
        {a.updateAvailable && a.updateReady && a.running && (
          <p className="note">{a.latest} is downloaded and installs as soon as you close {a.name}.</p>
        )}

        {facts.length > 0 && (
          <dl className="facts">
            {facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
          </dl>
        )}
        </>)}
      </section>

      <aside className="side">
        <TiltedCard imageSrc={a.icon} altText="" containerHeight="240px" containerWidth="240px" imageHeight="240px" imageWidth="240px"
          rotateAmplitude={10} scaleOnHover={1.04} glare={0} shadow={0.45} showTooltip={false} flipOnClick={false} radius={36} parallax={0}
          intro trackWindow={false} gyroscope={false} />
        {a.comingSoon ? (
          <p className="soon">Not out yet. It shows up here, ready to install, the day it's released.</p>
        ) : a.notes ? (
          <div className="notes">
            <h2>What's in {a.latest}</h2>
            {/* The fade sits on a frame that doesn't scroll, so it stays at the bottom edge */}
            <div className="notes-frame">
              <div className="notes-scroll"><Notes text={a.notes} /></div>
              <GradualBlur position="bottom" target="parent" height="2.5rem" strength={1.2} layers={5} zIndex={2} />
            </div>
          </div>
        ) : null}
      </aside>
    </AnimatedContent>
  );
}

function Settings({ settings, onChange }) {
  const rows = [
    ['autoUpdate', 'Keep apps up to date', 'Downloads each new version as soon as it is released. It installs straight away, or the moment you close the app if it is open.'],
    ['startWithWindows', 'Start with Windows', 'Opens in the tray when you sign in, so updates keep coming.'],
    ['closeToTray', 'Close to tray', 'Closing the window keeps the launcher running in the tray.'],
  ];
  return (
    <AnimatedContent key="settings" trigger="mount" distance={24} duration={0.55} ease="power3.out" className="page settings">
      <SplitText text="Settings" tag="h1" className="title" splitType="chars" delay={28} duration={0.7}
        textAlign="left" effect="rise" trigger="view" threshold={0} rootMargin="0px" />
      <ul className="setting-list">
        {rows.map(([key, title, help]) => (
          <li key={key}>
            <label>
              <span><strong>{title}</strong><small>{help}</small></span>
              <input type="checkbox" className="switch" checked={!!settings[key]} onChange={(e) => onChange({ [key]: e.target.checked })} />
            </label>
          </li>
        ))}
      </ul>
      <p className="version">Ranch Launcher {settings.version}</p>
    </AnimatedContent>
  );
}

const GearIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
    <path d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3.3h-4l-.4 2.6a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5-2.1-1.6ZM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z" transform="translate(-1 0)" />
  </svg>
);

export default function App() {
  const [apps, setApps] = useState([]);
  const [selected, setSelected] = useState(null);
  const [settings, setSettings] = useState({});
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    api.list().then((list) => {
      setApps(list);
      setSelected((s) => s || (list.find((a) => a.installed) || list[0])?.id || null);
    });
    api.getSettings().then(setSettings);
    api.onChanged((v) => setApps((list) => {
      const i = list.findIndex((a) => a.id === v.id);
      if (i < 0) return [...list, v];
      const next = list.slice();
      next[i] = v;
      return next;
    }));
  }, []);

  const current = apps.find((a) => a.id === selected);

  const checkNow = async () => {
    setChecking(true);
    setApps(await api.refresh());
    setChecking(false);
  };
  const changeSettings = async (patch) => setSettings({ ...(await api.setSettings(patch)), version: settings.version });

  // Installed apps first, then the rest, then Settings
  const dockItems = useMemo(() => {
    const ordered = [...apps].sort((x, y) => Number(y.installed) - Number(x.installed));
    return [
      ...ordered.map((a) => ({
        icon: <img src={a.icon} alt="" className={`dock-img${a.comingSoon ? ' is-soon' : ''}`} />,
        label: `${a.name} · ${statusOf(a)}`,
        onClick: () => setSelected(a.id),
        active: selected === a.id,
        badge: a.updateAvailable ? '1' : undefined,
      })),
      { icon: <span className="dock-gear"><GearIcon /></span>, label: 'Settings', onClick: () => setSelected('settings'), active: selected === 'settings' },
    ];
  }, [apps, selected]);

  return (
    <div className="shell">
      <div className="backdrop" aria-hidden="true">
        <Topography color="#2f4a2c" lineCount={26} lineWidth={1} glow={0} fog={0.55} brightness={0.9} speed={0.12}
          tilt={38} elevation={0.9} detail={0.3} morph={0.15} mouseStrength={0.35} clickEffect="none" markers="none" />
      </div>
      <Noise opacity={0.07} fps={8} contrast={0.5} blendMode="overlay" fixed zIndex={1} />

      <header className="topbar">
        <div className="brand"><img src="icons/ranch.png" alt="" /><span>Ranch</span></div>
        <button className="link quiet" onClick={checkNow} disabled={checking}>{checking ? 'Checking' : 'Check for updates'}</button>
      </header>

      <main className="main">
        {selected === 'settings'
          ? <Settings settings={settings} onChange={changeSettings} />
          : current && <AppPage key={current.id} a={current} />}
      </main>

      <div className="dock-wrap">
        <Dock items={dockItems} theme="dark" baseItemSize={52} magnification={68} distance={160} panelHeight={70}
          gap={12} roundness={0.32} tiles={false} showLabels showIndicators showBadges badgeColor={GREEN} accentColor={GREEN} />
      </div>
    </div>
  );
}
