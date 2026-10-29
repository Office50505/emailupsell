// @ts-nocheck
import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const flowOrder = ['abandoned_checkout', 'abandoned_checkout_follow_up', 'post_purchase_upsell'];
const flowMeta = {
  abandoned_checkout: { title: 'Checkout recovery', event: 'Cart abandoned', short: 'Recover an open checkout while intent is still fresh.', icon: '↗' },
  abandoned_checkout_follow_up: { title: 'Gentle follow-up', event: 'No purchase after recovery', short: 'One final reminder, only when the checkout remains open.', icon: '↻' },
  post_purchase_upsell: { title: 'Post-purchase add-ons', event: 'Order paid', short: 'Introduce useful products after an opted-in customer buys.', icon: '✦' }
};
const defaultTemplate = { heroEnabled: true, recommendationsEnabled: true, footerEnabled: true };
const defaults = {
  abandoned_checkout: { campaignType: 'abandoned_checkout', enabled: true, delayMinutes: 90, cooldownDays: 7, subject: 'Your Printmivo order is waiting', preheader: 'Your custom stamp is ready when you are.', heading: 'Still thinking it over{{first_name}}?', body: 'Your selected Printmivo items are still saved. Finish checkout whenever you are ready.', ctaLabel: 'Return to checkout', ctaUrl: '{{recovery_url}}', template: defaultTemplate },
  abandoned_checkout_follow_up: { campaignType: 'abandoned_checkout_follow_up', enabled: true, delayMinutes: 1440, cooldownDays: 7, subject: 'A little reminder from Printmivo', preheader: 'Your custom stamp is still ready when you are.', heading: 'Your custom stamp is still waiting{{first_name}}', body: 'Your saved Printmivo items are ready whenever you are. Complete your order when the timing feels right.', ctaLabel: 'Return to checkout', ctaUrl: '{{recovery_url}}', template: { ...defaultTemplate, recommendationsEnabled: false } },
  post_purchase_upsell: { campaignType: 'post_purchase_upsell', enabled: true, delayMinutes: 10080, cooldownDays: 7, subject: 'Complete your Printmivo kit', preheader: 'A few finishing touches for your next order.', heading: 'A useful next step{{first_name}}', body: 'Keep your branding consistent with practical add-ons picked for your recent Printmivo order.', ctaLabel: 'Shop recommended add-ons', ctaUrl: 'https://printmivo.com/collections/all', template: defaultTemplate }
};

function normalise(items = []) {
  const received = Object.fromEntries(items.map(item => [item.campaignType, { ...item, template: { ...defaultTemplate, ...(item.template || {}) } }]));
  return Object.fromEntries(flowOrder.map(id => [id, received[id] || { ...defaults[id], template: { ...defaults[id].template } }]));
}
async function api(path, options = {}) {
  const token = await window.shopify?.idToken?.();
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}
function cadence(minutes) {
  if (!Number.isFinite(minutes)) return '—';
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? '' : 's'}`;
  if (minutes % 60 === 0) return `${minutes / 60} hr`;
  return `${minutes} min`;
}
function flowCount(summary, type, status) { return summary?.counts?.[type]?.[status] || 0; }
function total(summary, status) { return flowOrder.reduce((sum, type) => sum + flowCount(summary, type, status), 0); }

function StatusDot({ live }) { return <i className={`status-dot ${live ? 'on' : ''}`} aria-label={live ? 'Active' : 'Paused'} />; }
function Metric({ label, value, note, accent }) { return <article className="metric"><span>{label}</span><strong className={accent ? 'accent' : ''}>{Number(value).toLocaleString()}</strong><small>{note}</small></article>; }
function Toggle({ checked, onChange, label, description }) { return <label className="toggle"><span><b>{label}</b>{description && <small>{description}</small>}</span><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} /><i /></label>; }
function FlowChip({ kind = 'email', title, detail, selected, onClick }) { return <button type="button" className={`flow-chip ${kind} ${selected ? 'selected' : ''}`} onClick={onClick}><i>{kind === 'entry' ? '◉' : kind === 'decision' ? '◇' : kind === 'exit' ? '✓' : '✉'}</i><span><b>{title}</b><small>{detail}</small></span></button>; }

function EmailPreview({ setting }) {
  const template = setting.template || defaultTemplate;
  return <div className="email-preview" aria-label="Email preview">
    <header><b>printmivo</b><span>Desktop</span></header>
    {template.heroEnabled && <div className="email-photo"><span>YOUR BRAND, READY TO MAKE AN IMPRESSION</span></div>}
    <section><em>{setting.preheader}</em><h3>{setting.heading.replace('{{first_name}}', ' Avery')}</h3><p>{setting.body}</p><button>{setting.ctaLabel} <span>→</span></button></section>
    <div className="email-reassurance"><b>Made for your packaging</b><span>Custom details that keep your brand consistent.</span></div>
    {template.recommendationsEnabled && <div className="email-products"><div><i>INK</i><b>Permanent Refill Ink</b><small>Keep every print crisp.</small></div><div><i>STICKERS</i><b>Custom Logo Stickers</b><small>The finishing touch.</small></div></div>}
    {template.footerEnabled && <footer><b>printmivo</b><span>Thoughtful details. Professional results.</span><small>Unsubscribe</small></footer>}
  </div>;
}

function App() {
  const [settings, setSettings] = useState(() => normalise());
  const [saved, setSaved] = useState(() => normalise());
  const [summary, setSummary] = useState({ audience: { subscribed: 0, suppressed: 0 }, counts: {}, recent: [] });
  const [page, setPage] = useState('overview');
  const [selected, setSelected] = useState('abandoned_checkout');
  const [editorTab, setEditorTab] = useState('content');
  const [mode, setMode] = useState('preview');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [sending, setSending] = useState(false);
  const setting = settings[selected];
  const queued = total(summary, 'queued');
  const sent = total(summary, 'sent');
  const skipped = total(summary, 'skipped');
  const recent = useMemo(() => summary.recent.slice(0, 8), [summary]);

  useEffect(() => {
    api('/api/admin/dashboard').then(data => {
      if (!Array.isArray(data.settings)) throw new Error('Open Email Studio from Shopify Admin to connect your secure session.');
      const next = normalise(data.settings); setSettings(next); setSaved(next); setSummary(data.summary); setMode(data.mode);
    }).catch(error => setNotice(error.message)).finally(() => setLoading(false));
  }, []);

  const selectFlow = id => { setSelected(id); setPage('automations'); setEditorTab('content'); };
  const edit = (key, value) => setSettings(current => ({ ...current, [selected]: { ...current[selected], [key]: value } }));
  const editTemplate = (key, value) => edit('template', { ...(setting.template || defaultTemplate), [key]: value });
  async function save() {
    try {
      const data = await api(`/api/admin/campaigns/${selected}`, { method: 'PUT', body: JSON.stringify(setting) });
      const next = { ...data.setting, template: { ...defaultTemplate, ...(data.setting.template || {}) } };
      setSettings(current => ({ ...current, [selected]: next })); setSaved(current => ({ ...current, [selected]: next })); setNotice('Saved. New jobs will use these rules and this full email template.');
    } catch (error) { setNotice(error.message); }
  }
  async function sendTest() {
    if (!/^\S+@\S+\.\S+$/.test(testEmail.trim())) return setNotice('Enter a valid email address for the test.');
    setSending(true);
    try {
      const data = await api(`/api/admin/campaigns/${selected}/test`, { method: 'POST', body: JSON.stringify({ email: testEmail }) });
      setNotice(data.mode === 'preview' ? 'Preview recorded safely. Set EMAIL_MODE=live to send through Resend.' : 'Test email sent. Check your inbox and expand the message if Gmail groups it in a thread.');
      setDialog(false);
    } catch (error) { setNotice(error.message); } finally { setSending(false); }
  }

  return <main className="studio">
    <header className="topbar"><button className="brand" onClick={() => setPage('overview')}><i>p</i><span><b>Printmivo</b><small>Email Studio</small></span></button><div className="top-actions"><span className={`mode ${mode}`}><StatusDot live={mode === 'live'} />{mode === 'live' ? 'Live sending' : 'Preview mode'}</span><button className="quiet-button" onClick={() => setDialog(true)}>Send test</button><em className="avatar">A</em></div></header>
    <div className="shell">
      <nav><p>WORKSPACE</p>{[['overview', '⌂', 'Overview'], ['automations', '⌘', 'Automations'], ['templates', '▤', 'Template'], ['audience', '◌', 'Audience'], ['insights', '⌁', 'Insights']].map(([id, icon, label]) => <button key={id} className={page === id ? 'active' : ''} onClick={() => setPage(id)}><i>{icon}</i>{label}</button>)}<aside><i>✓</i><b>Consent-aware sending</b><small>Recovery messages stay focused. Marketing flows require consent and always include unsubscribe.</small></aside></nav>
      <section className="content">
        {notice && <div className="notice"><span>●</span><p>{notice}</p><button onClick={() => setNotice('')}>×</button></div>}
        {page === 'overview' && <>
          <header className="page-heading"><div><h1>Email that feels considered.</h1><p>Build a clear journey for every moment after a shopper shares their email.</p></div><aside><StatusDot live={settings.abandoned_checkout.enabled} /><span><b>{settings.abandoned_checkout.enabled ? 'Recovery is active' : 'Recovery is paused'}</b><small>Saved rules apply to new jobs.</small></span></aside></header>
          <section className="scoreboard"><Metric label="Eligible audience" value={summary.audience.subscribed} note="marketing subscribers" /><Metric label="Queued now" value={queued} note="waiting in a flow" /><Metric label="Emails sent" value={sent} note="automation delivery" accent /><Metric label="Stopped safely" value={skipped} note="purchased, capped or opted out" /></section>
          <section className="journey-panel"><header><div><span>PRIMARY JOURNEY</span><h2>Abandoned checkout recovery</h2></div><button onClick={() => selectFlow('abandoned_checkout')}>Edit this journey <b>→</b></button></header><div className="journey-body"><div className="journey-track"><FlowChip kind="entry" title="Checkout left open" detail="Email captured at checkout" /><div className="journey-line"><small>wait {cadence(settings.abandoned_checkout.delayMinutes)}</small></div><FlowChip title="Recovery email" detail={settings.abandoned_checkout.enabled ? 'Active' : 'Paused'} selected onClick={() => selectFlow('abandoned_checkout')} /><div className="journey-line"><small>re-check order</small></div><FlowChip kind="decision" title="Did they purchase?" detail="Order webhook decides" /><div className="journey-split"><div><b>Yes</b><FlowChip kind="exit" title="Exit quietly" detail="No further email" /></div><div><b>No</b><FlowChip title="Follow-up" detail={`wait ${cadence(settings.abandoned_checkout_follow_up.delayMinutes)}`} onClick={() => selectFlow('abandoned_checkout_follow_up')} /></div></div></div><aside className="journey-summary"><span>FLOW HEALTH</span><div><b>{flowCount(summary, 'abandoned_checkout', 'sent') + flowCount(summary, 'abandoned_checkout_follow_up', 'sent')}</b><small>recovery emails sent</small></div><div><b>{flowCount(summary, 'abandoned_checkout', 'queued') + flowCount(summary, 'abandoned_checkout_follow_up', 'queued')}</b><small>currently waiting</small></div><p>Purchase detection stops the next message before it sends.</p></aside></div></section>
          <div className="overview-bottom"><section className="secondary-flow"><header><span>SECOND JOURNEY</span><button onClick={() => selectFlow('post_purchase_upsell')}>Edit →</button></header><h2>Post-purchase add-ons</h2><div><FlowChip kind="entry" title="Order paid" detail="Subscribed customer" /><i>→</i><small>{cadence(settings.post_purchase_upsell.delayMinutes)}</small><i>→</i><FlowChip title="Add-on email" detail={settings.post_purchase_upsell.enabled ? 'Active' : 'Paused'} onClick={() => selectFlow('post_purchase_upsell')} /></div></section><section className="event-panel"><header><span>RECENT ACTIVITY</span><button onClick={() => setPage('insights')}>View all →</button></header>{loading ? <p>Loading activity…</p> : recent.length ? <div>{recent.slice(0, 4).map((item, index) => <article key={`${item.recipient}-${index}`}><StatusDot live={item.status === 'sent'} /><b>{flowMeta[item.campaignType]?.title || item.campaignType}</b><span>{item.recipient}</span><em>{item.status}</em></article>)}</div> : <p>New delivery activity will appear here after the first run.</p>}</section></div>
        </>}
        {(page === 'automations' || page === 'templates') && <>
          <header className="page-heading compact"><div><h1>{page === 'templates' ? 'Template studio' : 'Automation builder'}</h1><p>Adjust the copy, layout and sending rules for each step in your customer journey.</p></div></header>
          <div className="editor-layout"><section className="flow-list"><header><span>YOUR FLOWS</span><small>Choose a message</small></header>{flowOrder.map(id => <button key={id} className={selected === id ? 'selected' : ''} onClick={() => setSelected(id)}><i>{flowMeta[id].icon}</i><span><b>{flowMeta[id].title}</b><small>{flowMeta[id].short}</small></span><em><StatusDot live={settings[id].enabled} />{settings[id].enabled ? 'On' : 'Off'}</em></button>)}<aside><b>Purchase is always an exit.</b><small>A matching order blocks any later recovery email.</small></aside></section>
            <section className="editor"><header><div><span>{page === 'templates' ? 'EMAIL TEMPLATE' : 'AUTOMATION STEP'}</span><h2>{flowMeta[selected].title}</h2><p>{flowMeta[selected].short}</p></div><Toggle checked={setting.enabled} onChange={value => edit('enabled', value)} label={setting.enabled ? 'Enabled' : 'Paused'} description="Saved state" /></header><div className="tabs"><button className={editorTab === 'content' ? 'active' : ''} onClick={() => setEditorTab('content')}>Content</button><button className={editorTab === 'layout' ? 'active' : ''} onClick={() => setEditorTab('layout')}>Layout</button><button className={editorTab === 'delivery' ? 'active' : ''} onClick={() => setEditorTab('delivery')}>Delivery</button></div>
              {editorTab === 'content' && <div className="form-fields"><label>Subject line<input value={setting.subject} onChange={e => edit('subject', e.target.value)} /></label><label>Preview text<input value={setting.preheader} onChange={e => edit('preheader', e.target.value)} /></label><label>Headline<input value={setting.heading} onChange={e => edit('heading', e.target.value)} /></label><label>Message<textarea rows="6" value={setting.body} onChange={e => edit('body', e.target.value)} /></label><div><label>Button label<input value={setting.ctaLabel} onChange={e => edit('ctaLabel', e.target.value)} /></label><label>Destination<input value={setting.ctaUrl} onChange={e => edit('ctaUrl', e.target.value)} /></label></div></div>}
              {editorTab === 'layout' && <div className="layout-options"><header><h3>A complete inbox experience</h3><p>The product and confidence modules remain in every email. Recommendations only appear where marketing consent allows them.</p></header><Toggle checked={setting.template.heroEnabled} onChange={value => editTemplate('heroEnabled', value)} label="Product hero" description="Lead with the product the customer was viewing." /><Toggle checked={setting.template.recommendationsEnabled} onChange={value => editTemplate('recommendationsEnabled', value)} label="Useful add-ons" description="Show refill ink and custom stickers to eligible marketing subscribers." /><Toggle checked={setting.template.footerEnabled} onChange={value => editTemplate('footerEnabled', value)} label="Brand footer" description="End with support, brand context and unsubscribe controls." /></div>}
              {editorTab === 'delivery' && <div className="delivery-fields"><label>Send after<div><input type="number" min="5" value={setting.delayMinutes} onChange={e => edit('delayMinutes', Number(e.target.value))} /><span>minutes</span></div><small>{cadence(setting.delayMinutes)} after {flowMeta[selected].event.toLowerCase()}.</small></label><label>Frequency cap<div><input type="number" min="1" max="90" value={setting.cooldownDays} onChange={e => edit('cooldownDays', Number(e.target.value))} /><span>days</span></div><small>Limits how often one eligible customer receives marketing email.</small></label><aside><b>What happens after this?</b><p>{selected === 'abandoned_checkout' ? `After this message, Printmivo waits ${cadence(settings.abandoned_checkout_follow_up.delayMinutes)}. A purchase exits; an open checkout can receive one follow-up.` : selected === 'abandoned_checkout_follow_up' ? 'This is the last recovery step. Purchase or no purchase, the journey exits afterwards.' : 'This message exits after delivery. A later eligible order can begin a new journey.'}</p></aside></div>}
              <footer><button onClick={() => setSettings(current => ({ ...current, [selected]: saved[selected] }))}>Reset</button><button className="primary" onClick={save}>Save changes</button></footer>
            </section>
            <aside className="preview-panel"><header><div><span>LIVE PREVIEW</span><h2>{flowMeta[selected].title}</h2></div><button onClick={() => setDialog(true)}>Send test</button></header><EmailPreview setting={setting} /><p>Your test uses the same full email structure, current layout toggles and unsubscribe footer as production.</p></aside>
          </div>
        </>}
        {page === 'audience' && <><header className="page-heading compact"><div><h1>Audience health</h1><p>Know who can receive each journey, and why others are kept out.</p></div></header><div className="audience-grid"><section><span>ELIGIBLE FOR MARKETING</span><b>{summary.audience.subscribed}</b><h2>Subscribed customers</h2><p>Can receive post-purchase messages and recommendations.</p></section><section><span>PROTECTED</span><b>{summary.audience.suppressed}</b><h2>Suppressed contacts</h2><p>Unsubscribed contacts never receive marketing email.</p></section><section><span>RECOVERY RULE</span><h2>One focused reminder</h2><p>An active incomplete checkout may receive one recovery email. It does not turn someone into a marketing subscriber.</p></section></div></>}
        {page === 'insights' && <><header className="page-heading compact"><div><h1>Delivery insights</h1><p>Review exactly what the automation has queued, sent or stopped.</p></div></header><section className="activity-table"><header><span>RECENT AUTOMATION EVENTS</span><b><StatusDot live />Updated from jobs</b></header>{loading ? <p>Loading delivery history…</p> : recent.length ? <div>{recent.map((item, index) => <article key={`${item.recipient}-${index}`}><StatusDot live={item.status === 'sent'} /><b>{flowMeta[item.campaignType]?.title || item.campaignType}</b><span>{item.recipient}</span><em>{item.status}</em><time>{new Date(item.timestamp).toLocaleDateString()}</time></article>)}</div> : <p>Your delivery history will appear here after the first automation run.</p>}</section></>}
      </section>
    </div>
    {dialog && <div className="modal" onMouseDown={() => !sending && setDialog(false)}><section onMouseDown={event => event.stopPropagation()}><button className="close" onClick={() => setDialog(false)} disabled={sending}>×</button><span>TEST DELIVERY</span><h2>Send the full email</h2><p>This sends the exact saved content and layout to the address you enter.</p><label>Email address<input autoFocus type="email" placeholder="you@company.com" value={testEmail} onChange={event => setTestEmail(event.target.value)} onKeyDown={event => event.key === 'Enter' && sendTest()} /></label><footer><button onClick={() => setDialog(false)} disabled={sending}>Cancel</button><button className="primary" onClick={sendTest} disabled={sending}>{sending ? 'Sending…' : 'Send test'}</button></footer></section></div>}
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);
