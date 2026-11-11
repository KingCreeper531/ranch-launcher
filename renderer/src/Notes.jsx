// Shows GitHub release notes. Only the bits of Markdown the notes use
// (headings, bullet lists, **bold**, `code`, [links]); never injects HTML.

function inline(text, keyBase) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const key = `${keyBase}-${i++}`;
    if (t.startsWith('**')) out.push(<strong key={key}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith('`')) out.push(<code key={key}>{t.slice(1, -1)}</code>);
    else out.push(t.slice(1, t.indexOf(']'))); // link text only
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function Notes({ text }) {
  const blocks = [];
  let list = null;
  text.split(/\r?\n/).forEach((raw, n) => {
    const line = raw.trim();
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      if (!list) { list = []; blocks.push({ type: 'ul', items: list }); }
      list.push(bullet[1]);
      return;
    }
    list = null;
    if (!line) return;
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    blocks.push(h ? { type: 'h', text: h[1], n } : { type: 'p', text: line, n });
  });
  return (
    <div className="notes-body">
      {blocks.map((b, i) => {
        if (b.type === 'ul') return <ul key={i}>{b.items.map((t, j) => <li key={j}>{inline(t, `${i}-${j}`)}</li>)}</ul>;
        if (b.type === 'h') return <h3 key={i}>{inline(b.text, i)}</h3>;
        return <p key={i}>{inline(b.text, i)}</p>;
      })}
    </div>
  );
}
