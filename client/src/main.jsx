import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const labelFor = {
  abandoned_checkout: 'Abandoned checkout',
  post_purchase_upsell: 'Post-purchase upsell'
};

const descriptionFor = {
  abandoned_checkout: 'Bring shoppers back while their intent is still high.',
  post_purchase_upsell: 'Introduce useful next products after a completed order.'
};

const emptySettings = {
  abandoned_checkout: { campaignType: 'abandoned_checkout', enabled: true, delayMinutes: 90, cooldownDays: 7, subject: 'Your Printmivo order is waiting', preheader: 'Your custom stamp is ready when you are.', heading: 'Still thinking it over{{first_name}}?', body: 'Your selected Printmivo items are still saved. Finish checkout whenever you are ready.', ctaLabel: 'Return to checkout', ctaUrl: '{{recovery_url}}' },
  post_purchase_upsell: { campaignType: 'post_purchase_upsell', enabled: true, delayMinutes: 10080, cooldownDays: 7, subject: 'Complete your Printmivo kit', preheader: 'A few finishing touches for your next order.', heading: 'A useful next step{{first_name}}', body: 'Keep your branding consistent with practical add-ons picked for your recent Printmivo order.', ctaLabel: 'Shop recommended add-ons', ctaUrl: 'https://printmivo.com/collections/all' }
};

async function authenticatedFetch(path, options = {}) {
  const token = await window.shopify?.idToken?.();
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

function formatDelay(minutes) {
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? '' : 's'}`;
  if (minutes % 60 === 0) return `${minutes / 60} hr`;
  return `${minutes} min`;
}

function Stat({ value, label, tone = 'dark' }) {
  return <div className={`stat ${tone}`}><strong>{value}</strong><span>{label}</span></div>;
}

function CampaignRow({ setting, summary, onSelect, active }) {
  const sent = summary?.counts?.[setting.campaignType]?.sent || 0;
  const queued = summary?.counts?.[setting.campaignType]?.queued || 0;
  return <button className={`campaign-row ${active ? 'active' : ''}`} onClick={() => onSelect(setting.campaignType)}>
    <span className="campaign-icon">{setting.campaignType === 'abandoned_checkout' ? '↗' : '✦'}</span>
    <span className="campaign-copy"><strong>{labelFor[setting.campaignType]}</strong><small>{descriptionFor[setting.campaignType]}</small></span>
    <span className="campaign-status"><i className={setting.enabled ? 'dot on' : 'dot'}></i>{setting.enabled ? 'Active' : 'Paused'}</span>
    <span className="campaign-number"><b>{queued}</b><small>queued</small></span>
    <span className="campaign-number"><b>{sent}</b><small>sent</small></span>
    <span className="campaign-chevron">›</span>
  </button>;
}

function App() {
  const [settings, setSettings] = useState(emptySettings);
  const [savedSettings, setSavedSettings] = useState(emptySettings);
  const [summary, setSummary] = useState({ audience: { subscribed: 0, suppressed: 0 }, counts: {}, recent: [] });
  const [selected, setSelected] = useState('abandoned_checkout');
  const [mode, setMode] = useState('preview');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [testEmail, setTestEmail] = useState('');
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);

  const setting = settings[selected];
  const activity = useMemo(() => summary.recent.slice(0, 5), [summary]);

  useEffect(() => {
    authenticatedFetch('/api/admin/dashboard')
      .then(data => {
        if (!Array.isArray(data.settings) || !data.summary) throw new Error('Open Email studio from Shopify Admin to connect your secure session.');
        const loadedSettings = Object.fromEntries(data.settings.map(item => [item.campaignType, item]));
        setSettings(loadedSettings);
        setSavedSettings(loadedSettings);
        setSummary(data.summary);
        setMode(data.mode);
      })
      .catch(error => setNotice(error.message))
      .finally(() => setLoading(false));
  }, []);

  function updateField(key, value) {
    setSettings(current => ({ ...current, [selected]: { ...current[selected], [key]: value } }));
  }

  async function saveCampaign() {
    try {
      const data = await authenticatedFetch(`/api/admin/campaigns/${selected}`, { method: 'PUT', body: JSON.stringify(setting) });
      setSettings(current => ({ ...current, [selected]: data.setting }));
      setSavedSettings(current => ({ ...current, [selected]: data.setting }));
      setNotice('Changes saved. New jobs will follow this campaign setup.');
    } catch (error) { setNotice(error.message); }
  }

  async function sendTest() {
    if (!/^\S+@\S+\.\S+$/.test(testEmail.trim())) {
      setNotice('Enter a valid email address for the test.');
      return;
    }
    setSendingTest(true);
    try {
      const data = await authenticatedFetch(`/api/admin/campaigns/${selected}/test`, { method: 'POST', body: JSON.stringify({ email: testEmail }) });
      setNotice(data.mode === 'preview' ? 'Preview logged safely. Set EMAIL_MODE=live to deliver through Resend.' : 'Test email sent. Check the inbox you entered.');
      setTestDialogOpen(false);
    } catch (error) { setNotice(error.message); }
    finally { setSendingTest(false); }
  }

  return <main className="app-shell">
    <header className="topbar"><div className="brand-mark">p</div><div><strong>Printmivo</strong><span>Email studio</span></div><div className="topbar-right"><span className={`mode ${mode}`}>{mode === 'live' ? 'Live sending' : 'Preview mode'}</span><span className="avatar">A</span></div></header>
    <div className="layout">
      <aside className="sidebar"><span className="eyebrow">AUTOMATION</span><button className="nav-item active">Overview</button><button className="nav-item">Campaigns</button><button className="nav-item">Audience</button><div className="sidebar-bottom"><button className="nav-item">Settings</button><small>Respectful email, by default.</small></div></aside>
      <section className="content">
        <div className="hero"><div><span className="eyebrow">EMAIL AUTOMATIONS</span><h1>Keep the conversation<br/>moving.</h1><p>Send helpful follow-ups at the right moment—without losing the feel of your brand.</p></div><div className="hero-note"><span className="spark">✦</span><strong>Automations run quietly in the background.</strong><small>Every email honours consent and frequency limits.</small></div></div>
        {notice && <div className="notice"><span>●</span>{notice}<button onClick={() => setNotice('')}>×</button></div>}
        <div className="stats"><Stat value={summary.audience.subscribed.toLocaleString()} label="marketing subscribers"/><Stat value={Object.values(summary.counts).reduce((total, item) => total + (item.sent || 0), 0).toLocaleString()} label="emails sent" tone="green"/><Stat value={Object.values(summary.counts).reduce((total, item) => total + (item.queued || 0), 0).toLocaleString()} label="waiting to send"/><Stat value={summary.audience.suppressed.toLocaleString()} label="unsubscribed"/></div>
        <section className="panel campaign-panel"><div className="panel-heading"><div><span className="eyebrow">YOUR FLOWS</span><h2>Campaigns</h2></div><span className="subtle">Only opted-in shoppers are eligible.</span></div>{Object.values(settings).map(item => <CampaignRow key={item.campaignType} setting={item} summary={summary} active={selected === item.campaignType} onSelect={setSelected}/>)}</section>
        <section className="editor-grid"><div className="panel editor"><div className="panel-heading"><div><span className="eyebrow">EDITING</span><h2>{labelFor[selected]}</h2></div><label className="switch"><input type="checkbox" checked={setting.enabled} onChange={event => updateField('enabled', event.target.checked)}/><span></span>{setting.enabled ? 'On' : 'Off'}</label></div><p className="editor-intro">{descriptionFor[selected]}</p><div className="timing"><label><span>Send after</span><input type="number" min="5" value={setting.delayMinutes} onChange={event => updateField('delayMinutes', Number(event.target.value))}/><small>minutes · {formatDelay(setting.delayMinutes)}</small></label><label><span>Frequency cap</span><input type="number" min="1" max="90" value={setting.cooldownDays} onChange={event => updateField('cooldownDays', Number(event.target.value))}/><small>days between marketing emails</small></label></div><div className="field"><label>Subject line</label><input value={setting.subject} onChange={event => updateField('subject', event.target.value)}/></div><div className="field"><label>Preview text</label><input value={setting.preheader} onChange={event => updateField('preheader', event.target.value)}/></div><div className="field"><label>Headline</label><input value={setting.heading} onChange={event => updateField('heading', event.target.value)}/></div><div className="field"><label>Message</label><textarea rows="4" value={setting.body} onChange={event => updateField('body', event.target.value)}/></div><div className="two-fields"><div className="field"><label>Button label</label><input value={setting.ctaLabel} onChange={event => updateField('ctaLabel', event.target.value)}/></div><div className="field"><label>Destination</label><input value={setting.ctaUrl} onChange={event => updateField('ctaUrl', event.target.value)}/></div></div><div className="editor-actions"><button className="button secondary" onClick={() => setSettings(current => ({ ...current, [selected]: savedSettings[selected] }))}>Reset</button><button className="button primary" onClick={saveCampaign}>Save changes</button></div></div>
        <div className="right-column"><section className="panel preview"><div className="panel-heading"><div><span className="eyebrow">LIVE PREVIEW</span><h2>In their inbox</h2></div><span className="phone-dot"></span></div><div className="mail-card"><div className="mail-brand">PRINTMIVO</div><small>{setting.preheader}</small><h3>{setting.heading.replace('{{first_name}}', ' Avery')}</h3><p>{setting.body}</p><button>{setting.ctaLabel}</button><div className="mail-footer">Thoughtful branding, made easy.<br/>Unsubscribe</div></div></section><section className="panel test-send"><span className="eyebrow">CHECK BEFORE YOU SEND</span><h2>Send a test</h2><p>Send the selected campaign's exact saved email to yourself before it reaches customers.</p><button className="button dark" onClick={() => setTestDialogOpen(true)}>Send test email</button></section></div></section>
        <section className="panel activity"><div className="panel-heading"><div><span className="eyebrow">DELIVERY LOG</span><h2>Recent activity</h2></div><span className="subtle">Last 8 automation events</span></div>{loading ? <p className="empty">Loading your latest campaign activity…</p> : activity.length ? <div className="activity-list">{activity.map((item, index) => <div className="activity-row" key={`${item.recipient}-${index}`}><span className={`status-dot ${item.status}`}></span><strong>{labelFor[item.campaignType]}</strong><span>{item.recipient}</span><span>{item.status}</span><time>{new Date(item.timestamp).toLocaleDateString()}</time></div>)}</div> : <p className="empty">Your delivery history will appear here after the first campaign run.</p>}</section>
      </section>
    </div>
    {testDialogOpen && <div className="dialog-backdrop" role="presentation" onMouseDown={() => !sendingTest && setTestDialogOpen(false)}>
      <section className="test-dialog" role="dialog" aria-modal="true" aria-labelledby="test-dialog-title" onMouseDown={event => event.stopPropagation()}>
        <button className="dialog-close" aria-label="Close test email dialog" onClick={() => setTestDialogOpen(false)} disabled={sendingTest}>×</button>
        <span className="eyebrow">TEST DELIVERY</span>
        <h2 id="test-dialog-title">Send yourself the {labelFor[selected].toLowerCase()} email</h2>
        <p>This sends the same saved subject, message, CTA and unsubscribe footer your customer would receive.</p>
        <label className="field"><span>Email address</span><input autoFocus type="email" placeholder="you@company.com" value={testEmail} onChange={event => setTestEmail(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') sendTest(); }}/></label>
        <div className="dialog-actions"><button className="button secondary" onClick={() => setTestDialogOpen(false)} disabled={sendingTest}>Cancel</button><button className="button primary" onClick={sendTest} disabled={sendingTest}>{sendingTest ? 'Sending…' : 'Send test email'}</button></div>
      </section>
    </div>}
  </main>;
}

createRoot(document.getElementById('root')).render(<App/>);
