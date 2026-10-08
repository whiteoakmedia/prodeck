// The "Join the ProDeck Crew" poster: one page with the join QR code, printed
// from the system browser (openPrintHtml), because window.print() inside the
// app's own window isn't allowed and doesn't work on macOS anyway. Used by
// first-run setup and Settings → Crew Members.

export function joinPosterHtml(qrDataUrl: string): string {
  return (
    `<!doctype html><html><head><meta charset="utf-8"><title>Join ProDeck Crew</title>` +
    `<style>body{font-family:-apple-system,Helvetica,sans-serif;text-align:center;padding:48px;color:#111}` +
    `h1{font-size:40px;margin:0 0 6px}p{font-size:20px;color:#444;margin:6px 0}` +
    `img{width:340px;height:340px;margin:28px 0}ol{display:inline-block;text-align:left;font-size:22px;line-height:1.7}</style></head><body>` +
    `<h1>Join the ProDeck Crew</h1><p>Your production &amp; worship team app</p>` +
    `<img src="${qrDataUrl.replace(/"/g, "")}" alt="QR">` +
    `<ol><li>Scan the code with your phone camera</li>` +
    `<li>Add ProDeck to your Home Screen when asked</li>` +
    `<li>Tap your name, pick a 4-digit PIN, and you're in</li></ol>` +
    `<script>window.onload=function(){setTimeout(function(){window.print();},300);};</script>` +
    `</body></html>`
  );
}
