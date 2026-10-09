/* Apply the saved theme before first paint. Keep the key in sync with THEME_STORAGE_KEY. */
;(function () {
  try {
    var saved = localStorage.getItem('surf-theme')
    if (saved === 'light' || saved === 'dark') document.documentElement.setAttribute('data-theme', saved)
  } catch (e) {}
})()
