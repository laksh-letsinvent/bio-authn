async function initAtlas() {
  const content = document.getElementById('atlas-content');
  const subnav  = document.getElementById('atlas-subnav');

  try {
    const res = await fetch('content/ATLAS.md');
    if (!res.ok) throw new Error(res.statusText);
    let md = await res.text();

    // rewrite §7/§8 pointers to link to separate pages
    md = md
      .replace(/`STANDARDS\.md`/g, '[STANDARDS.md](content/STANDARDS.md)')
      .replace(/`COMPLIANCE\.md`/g, '[COMPLIANCE.md](content/COMPLIANCE.md)');

    content.innerHTML = marked.parse(md);

    // build sub-nav from h2 headings
    const headings = content.querySelectorAll('h2');
    const links = [];
    headings.forEach((h, i) => {
      const id = 'atlas-h-' + i;
      h.id = id;
      const a = document.createElement('a');
      a.href = '#' + id;
      a.textContent = h.textContent;
      a.addEventListener('click', e => {
        e.preventDefault();
        h.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      subnav.appendChild(a);
      links.push({ el: h, link: a });
    });

    // highlight active heading on scroll
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const match = links.find(l => l.el === entry.target);
        if (match && entry.isIntersecting) {
          links.forEach(l => l.link.style.color = '');
          match.link.style.color = 'var(--primary)';
          match.link.style.borderLeftColor = 'var(--primary)';
        }
      });
    }, { rootMargin: '-20% 0px -70% 0px' });

    headings.forEach(h => observer.observe(h));

    // attribution at bottom
    const links2 = document.createElement('div');
    links2.className = 'attribution';
    links2.innerHTML =
      'See also: <a href="content/STANDARDS.md" target="_blank">STANDARDS.md</a> · ' +
      '<a href="content/COMPLIANCE.md" target="_blank">COMPLIANCE.md</a>';
    content.appendChild(links2);

  } catch (err) {
    content.innerHTML =
      '<div class="callout callout-warn"><strong>Could not load ATLAS.md.</strong> ' +
      'Serve this portal with <code>python -m http.server</code> from the portal directory. ' +
      err.message + '</div>';
  }
}
