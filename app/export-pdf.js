(() => {
  'use strict';

  // Reserve a little room below the standard PDF maximum page dimension (200 in).
  // The SVG viewBox preserves the paths and text when a very wide tree is scaled.
  const maxPagePoints = 14000;
  let finishPrevious = null;

  function save(svg, filename) {
    if (finishPrevious) finishPrevious();

    const {width, height} = svg.viewBox.baseVal;
    if (!(width > 0 && height > 0)) throw new Error('Схема для PDF порожня.');
    const pointsPerUnit = Math.min(72 / 96, maxPagePoints / Math.max(width, height));
    const pageWidth = Math.ceil(width * pointsPerUnit);
    const pageHeight = Math.ceil(height * pointsPerUnit);

    // A constructed stylesheet also works with the hosted viewer's strict CSP.
    // Keep the scrollable viewer mounted; only the printed page uses this layout.
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`
      #tree-print-sheet { display: none; }
      @page { size: ${pageWidth}pt ${pageHeight}pt; margin: 0; }
      @media print {
        html, body { margin: 0 !important; padding: 0 !important; min-width: 0 !important;
          min-height: 0 !important; height: auto !important; overflow: visible !important; }
        body > :not(#tree-print-sheet) { display: none !important; }
        #tree-print-sheet { display: block !important; position: absolute; inset: 0 auto auto 0;
          width: ${pageWidth}pt; height: ${pageHeight}pt; overflow: hidden;
          -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        #tree-print-sheet > svg { display: block; width: 100%; height: 100%; }
      }
    `);
    const page = document.createElement('div');
    page.id = 'tree-print-sheet';
    page.append(svg.cloneNode(true));
    const title = document.title;

    function finish() {
      window.removeEventListener('afterprint', finish);
      window.removeEventListener('pagehide', finish);
      page.remove();
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter(item => item !== sheet);
      document.title = title;
      finishPrevious = null;
    }
    finishPrevious = finish;
    try {
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      document.body.append(page);
      document.title = filename.replace(/\.pdf$/i, '');
      window.addEventListener('afterprint', finish, {once: true});
      window.addEventListener('pagehide', finish, {once: true});
      window.print();
    } catch (error) {
      finish();
      throw error;
    }
  }

  window.TreeExportPDF = {save};
})();
