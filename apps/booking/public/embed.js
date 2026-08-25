/* Velnes booking widget loader.
 *
 * On the salon's own site:
 *   <script src="https://book.velnes.mk/embed.js"
 *           data-velnes-key="pk_live_..." async></script>
 *
 * The script drops an iframe with the booking flow where the tag
 * stands. The publishable key is safe to expose; the API refuses any
 * domain the widget has not registered. A `{velnes:'close'}` message
 * from the flow collapses the frame again.
 */
(function () {
  var script = document.currentScript;
  if (!script) return;
  var key = script.getAttribute('data-velnes-key');
  if (!key) {
    console.warn('[velnes] embed.js needs data-velnes-key');
    return;
  }
  var origin = new URL(script.src).origin;
  var frame = document.createElement('iframe');
  frame.src = origin + '/w?pk=' + encodeURIComponent(key);
  frame.title = 'Book an appointment';
  frame.style.cssText =
    'width:100%;max-width:720px;height:820px;border:0;border-radius:18px;display:block;margin:0 auto';
  frame.allow = 'payment';
  script.parentNode.insertBefore(frame, script.nextSibling);
  window.addEventListener('message', function (e) {
    if (e.source === frame.contentWindow && e.data && e.data.velnes === 'close') {
      frame.style.display = frame.style.display === 'none' ? 'block' : 'none';
    }
  });
})();
