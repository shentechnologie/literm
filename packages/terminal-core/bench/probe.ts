import { TerminalSession } from '../src/session';
import { glyphShowcase } from '../../../apps/mobile/src/lab/load';

const session = new TerminalSession({ cols: 51, rows: 36, scrollback: 1000 });
await new Promise<void>((resolve) => session.term.write(glyphShowcase(), () => resolve()));
// give deferred parse batches a chance
await new Promise((r) => setTimeout(r, 50));
const frame = session.frame();
console.log('altBuffer', frame.altBuffer, 'viewportY', frame.viewportY, 'dirty', frame.dirty.length);
for (let i = 0; i < 8; i++) {
  const row = frame.rows[i]!;
  console.log(
    i,
    'y=' + row.y,
    'runs=' + row.runs.length,
    'hash=' + row.hash,
    JSON.stringify(row.text.slice(0, 28)),
    row.runs.slice(0, 3).map((r) => `${r.x}w${r.width}:${JSON.stringify(r.text.slice(0, 6))}${r.ascii ? '' : ' (non-ascii)'}`).join(' | '),
  );
}
console.log('cursor', frame.cursor);
