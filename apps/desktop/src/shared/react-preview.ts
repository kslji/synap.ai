/**
 * React preview: Sucrase (MIT) turns JSX into h() calls. The iframe stays
 * sandbox="allow-scripts" with no network. Sucrase runs in the app, not from a CDN.
 */
import { transform } from 'sucrase'
import { previewDocument, type PreviewDoc } from './preview-doc.js'

const RUNTIME = `
function h(type, props) {
  var children = Array.prototype.slice.call(arguments, 2)
  if (props && props.children != null) children = children.concat(props.children)
  children = children.flat().filter(function (child) { return child != null && child !== false })
  if (typeof type === 'function') return type(Object.assign({}, props, { children: children }))
  var el = document.createElement(type)
  var attrs = props || {}
  Object.keys(attrs).forEach(function (key) {
    if (key === 'children' || key === 'key') return
    if (key === 'className') el.setAttribute('class', String(attrs[key]))
    else if (key === 'style' && attrs[key] && typeof attrs[key] === 'object') el.setAttribute('style', Object.keys(attrs[key]).map(function (name) { return name + ':' + attrs[key][name] }).join(';'))
    else if (key.slice(0, 2) !== 'on') el.setAttribute(key, String(attrs[key]))
  })
  children.forEach(function (child) {
    if (child && child.nodeType) el.appendChild(child)
    else el.appendChild(document.createTextNode(String(child)))
  })
  return el
}
function Fragment(props) { var box = document.createElement('div'); (props.children || []).forEach(function (child) { if (child && child.nodeType) box.appendChild(child) }); return box }
function render(node, parent) { parent.textContent = ''; if (node && node.nodeType) parent.appendChild(node) }
`

export function reactPreviewDocument(source: string): PreviewDoc {
  const compiled = transform(source, {
    transforms: ['jsx', 'typescript'],
    jsxPragma: 'h',
    jsxFragmentPragma: 'Fragment',
    production: true,
  }).code
  const boot = `
${compiled}
var view = (typeof Harbor !== 'undefined' && Harbor) || (typeof App !== 'undefined' && App) || null
if (typeof view === 'function') render(h(view, null), document.getElementById('root'))
`
  const html = `<div id="root"></div><script>${RUNTIME}\n${boot}</script>`
  return previewDocument(html)
}
