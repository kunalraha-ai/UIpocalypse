// Plain Pages — hand-written vanilla JS, no framework, no build step.
// Direct DOM work everywhere: appends, class toggles, text writes.
(function () {
  // ---- theme toggle (always alive: classList.toggle flips both ways)
  var theme = document.getElementById('theme');
  if (theme) theme.addEventListener('click', function () {
    document.body.classList.toggle('dark');
  });

  // ---- destructive guard surface (BAD-label control; must never be clicked)
  var deleter = document.getElementById('deleter');
  if (deleter) deleter.addEventListener('click', function () {
    if (confirm('Really delete?')) document.body.textContent = 'gone';
  });

  // ---- catalog filters (idempotent when the filter is already active)
  var ITEMS = {
    tools: ['hammer', 'wrench', 'drill'],
    books: ['dune', 'snow crash', 'the moon is a harsh mistress'],
  };
  var currentCat = null;
  var shown = 0;
  function render() {
    var list = document.getElementById('list');
    if (!list) return;
    list.textContent = '';
    var items = (ITEMS[currentCat] || []).slice(0, shown);
    for (var i = 0; i < items.length; i++) {
      var div = document.createElement('div');
      div.className = 'item';
      div.textContent = items[i];
      list.appendChild(div);
    }
  }
  window.pickFilter = function (cat) {
    if (cat === currentCat) return; // idempotent early-return — repeat surface
    currentCat = cat;
    shown = 2;
    document.querySelectorAll('.filter').forEach(function (b) {
      b.style.fontWeight = b.dataset.cat === cat ? '700' : '400';
    });
    render();
  };
  var more = document.getElementById('more');
  if (more) more.addEventListener('click', function () {
    if (!currentCat || shown >= (ITEMS[currentCat] || []).length) return; // exhausted → no-op
    shown += 1;
    render();
  });

  // ---- notes
  // PLANTED DEAD #3: a handler that exists but never touches the DOM,
  // the network, or any state — the subtle dead control.
  window.saveNote = function () {
    var note = document.getElementById('note');
    if (note) { void note.value; } // reads the value and does nothing
  };
})();
