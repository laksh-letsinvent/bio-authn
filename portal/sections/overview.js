async function initOverview() {
  const content = document.getElementById('overview-content');
  try {
    const res = await fetch('content/OVERVIEW.md');
    if (!res.ok) throw new Error(res.statusText);
    const md = await res.text();
    content.innerHTML = marked.parse(md);

    // internal #section links should route, not jump
    content.querySelectorAll('a[href^="#"]').forEach(a => {
      a.addEventListener('click', e => {
        e.preventDefault();
        location.hash = a.getAttribute('href');
      });
    });
  } catch (err) {
    content.innerHTML =
      '<div class="callout callout-warn"><strong>Could not load OVERVIEW.md.</strong> ' +
      'Serve this portal with <code>python -m http.server</code> from the portal directory. ' +
      err.message + '</div>';
  }
}
