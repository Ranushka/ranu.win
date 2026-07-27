(function () {
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  document.querySelectorAll('.hero-nav a[href^="#"]').forEach((link) => {
    link.addEventListener('click', (e) => {
      const target = document.querySelector(link.getAttribute('href'));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });

  // Fades each section's glass panel in as the ship arrives (see .in-view in style.css).
  // A plain threshold (e.g. 0.35) requires that fraction of the *section's own* height to be
  // visible — impossible for a section taller than viewport/threshold (Experience, with its
  // 5-item timeline, is taller than that), so it would never trigger. Shrinking the observer's
  // root to a thin band around viewport-center instead fires whenever a section is crossing the
  // middle of the screen, regardless of how tall that section is.
  const sections = document.querySelectorAll('.section');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        entry.target.classList.toggle('in-view', entry.isIntersecting);
      });
    }, { threshold: 0, rootMargin: '-40% 0px -40% 0px' });
    sections.forEach((section) => io.observe(section));
  } else {
    sections.forEach((section) => section.classList.add('in-view'));
  }
})();
