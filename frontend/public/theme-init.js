// Runs before the page is drawn: choose light or dark so there is no white flash. See index.html.
;(function () {
  var theme = 'light'
  try {
    var pref = localStorage.getItem('tf-theme')
    var dark =
      pref === 'dark' ||
      (pref !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    theme = dark ? 'dark' : 'light'
  } catch {}
  document.documentElement.setAttribute('data-theme', theme)
})()
