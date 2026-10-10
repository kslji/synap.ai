/* Apply the saved theme before first paint. Keep the key in sync with THEME_STORAGE_KEY. */
;(function () {
  try {
    var saved = localStorage.getItem('surf-theme')
    if (saved === 'system') {
      saved = 'light'
      localStorage.setItem('surf-theme', 'light')
    }
    if (saved !== 'dark') saved = 'light'
    document.documentElement.setAttribute('data-theme', saved)
  } catch (e) {
    try { document.documentElement.setAttribute('data-theme', 'light') } catch (err) {}
  }
})()
