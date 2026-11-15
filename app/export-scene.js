/* Draw the currently displayed family graph in unzoomed chart coordinates. */
window.TreeExportScene = (() => {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const sans = "'Helvetica Neue', Arial, sans-serif";
  const serif = "Georgia, 'Times New Roman', serif";
  const gutter = 24;

  function element(tag, attributes, parent) {
    const node = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attributes)) {
      if (value != null) node.setAttribute(key, typeof value === 'number' ? +value.toFixed(3) : value);
    }
    if (parent) parent.appendChild(node);
    return node;
  }

  function text(parent, content, x, y, size, attributes = {}) {
    const node = element('text', {
      x, y, 'font-family': sans, 'font-size': size, fill: '#23382c', ...attributes
    }, parent);
    node.textContent = content;
    return node;
  }

  // The browser already wrapped the card to its natural height. Measure each
  // actual line from its text node, including words split by overflow-wrap.
  // All DOM reads use anchor-relative coordinates so panning and zoom cancel.
  function drawLines(parent, label, anchor, x, y, scale, measure) {
    const content = label.firstChild;
    if (!content || content.nodeType !== Node.TEXT_NODE || !content.length) return;
    const css = getComputedStyle(label);
    const size = parseFloat(css.fontSize);
    measure.font = css.fontWeight + ' ' + css.fontSize + ' ' + css.fontFamily;
    const metrics = measure.measureText('Друк');
    const ascent = metrics.fontBoundingBoxAscent ?? size * .8;
    const descent = metrics.fontBoundingBoxDescent ?? size * .2;
    const range = document.createRange();
    const letters = content.textContent;
    for (let start = 0; start < letters.length;) {
      while (start < letters.length && /\s/u.test(letters[start])) start++;
      if (start === letters.length) break;
      range.setStart(content, start);
      range.setEnd(content, letters.length);
      let end = letters.length;
      if (range.getClientRects().length > 1) {
        // The first prefix producing a second line is just past the line break.
        let low = start + 1, high = letters.length;
        while (low < high) {
          const mid = Math.ceil((low + high) / 2);
          range.setEnd(content, mid);
          if (range.getClientRects().length <= 1) low = mid;
          else high = mid - 1;
        }
        end = low;
      }
      const line = letters.slice(start, end).trimEnd();
      if (line) {
        range.setEnd(content, start + line.length);
        const rect = range.getBoundingClientRect();
        const baseline = (rect.height / scale + ascent - descent) / 2;
        text(parent, line, x + (rect.left - anchor.left) / scale,
          y + (rect.top - anchor.top) / scale + baseline, size, {
            'font-family': css.fontFamily, 'font-weight': css.fontWeight, fill: css.color,
            textLength: rect.width / scale, lengthAdjust: 'spacingAndGlyphs'
          });
      }
      start = end;
    }
  }

  function drawAvatar(group, image, anchor, x, y, scale, forPrint) {
    if (!image.complete || !image.naturalWidth) return;
    const rect = image.getBoundingClientRect();
    const canvas = document.createElement('canvas');
    const size = 128;
    canvas.width = canvas.height = size;
    const css = getComputedStyle(image);
    const ratio = (css.objectFit === 'contain' ? Math.min : Math.max)(size/image.naturalWidth,size/image.naturalHeight);
    const w = image.naturalWidth*ratio, h = image.naturalHeight*ratio;
    const [left,top] = css.objectPosition.split(' ').map(p => parseFloat(p)/100);
    let href = forPrint ? image.src : window.familyExportPortraits?.[image.dataset.portraitSha256];
    if (!href) {
      const context = canvas.getContext('2d');
      context.drawImage(image,(size-w)*left,(size-h)*top,w,h);
      try { href = canvas.toDataURL('image/png'); }
      catch { return; }
      element('image', {href,x:x+(rect.left-anchor.left)/scale,y:y+(rect.top-anchor.top)/scale,
        width:rect.width/scale,height:rect.height/scale},group);
      return;
    }
    const clip = element('svg',{x:x+(rect.left-anchor.left)/scale,y:y+(rect.top-anchor.top)/scale,
      width:rect.width/scale,height:rect.height/scale,viewBox:'0 0 128 128',overflow:'hidden'},group);
    element('image',{href,x:(size-w)*left,y:(size-h)*top,width:w,height:h},clip);
  }

  function drawCard(parent, card, node, scale, measure, forPrint) {
    const {x, y, w, h} = node;
    const css = getComputedStyle(card);
    const group = element('g', {'data-person-key': node.key, opacity: css.opacity}, parent);
    const shape = {x, y, width: w, height: h, rx: parseFloat(css.borderRadius)};
    element('rect', {
      ...shape, fill: css.backgroundColor, stroke: css.borderTopColor, 'stroke-width': 1
    }, group);
    if (card.classList.contains('on-route')) {
      const familyView = card.parentElement.classList.contains('family-view');
      element('rect', {
        x: x + 1.5, y: y + 1.5, width: w - 3, height: h - 3, rx: shape.rx - 1,
        fill: 'none', stroke: familyView ? '#8a542b' : (css.getPropertyValue('--family-ink').trim() || '#738870'),
        'stroke-width': familyView ? 2 : 1.5
      }, group);
    }
    if (card.matches('.sel,.graph-focus')) {
      element('rect', {
        x: x - 3.5, y: y - 3.5, width: w + 7, height: h + 7, rx: shape.rx + 3.5,
        fill: 'none', stroke: css.outlineColor, 'stroke-width': parseFloat(css.outlineWidth) || 2
      }, group);
    }
    const anchor = card.getBoundingClientRect();
    for (const child of card.children) {
      if (!child.getClientRects().length) continue;
      if (child.classList.contains('tile-identity')) {
        drawAvatar(group,child.querySelector('img'),anchor,x,y,scale,forPrint);
        drawLines(group,child.querySelector('strong'),anchor,x,y,scale,measure);
        continue;
      }
      if (child.classList.contains('profession-tags')) {
        drawLines(group, child.querySelector('.profession-label'), anchor, x, y, scale, measure);
      }
      const badges = child.querySelectorAll('[data-evidence-kind],.profession-tag');
      if (badges.length) {
        for (const badge of badges) {
          const rect = badge.getBoundingClientRect();
          if (!rect.width || !rect.height) continue;
          const style = getComputedStyle(badge);
          element('rect', {
            x: x + (rect.left - anchor.left) / scale, y: y + (rect.top - anchor.top) / scale,
            width: rect.width / scale, height: rect.height / scale, rx: parseFloat(style.borderRadius) || 0,
            fill: style.backgroundColor, stroke: style.borderTopColor, 'stroke-width': parseFloat(style.borderTopWidth) || 0
          }, group);
          drawLines(group, badge, anchor, x, y, scale, measure);
        }
        continue;
      }
      if (!child.classList.contains('lineage-junction')) {
        drawLines(group, child, anchor, x, y, scale, measure);
        continue;
      }
      for (const swatch of child.children) {
        const rect = swatch.getBoundingClientRect(), style = getComputedStyle(swatch);
        element('rect', {
          x: x + (rect.left - anchor.left) / scale, y: y + (rect.top - anchor.top) / scale,
          width: rect.width / scale, height: rect.height / scale, rx: 3,
          fill: style.backgroundColor, stroke: style.borderTopColor, 'stroke-width': 1
        }, group);
      }
    }
  }

  function drawGraph(parent, scene, layout, measure, forPrint) {
    const scale = scene.getBoundingClientRect().width / layout.width;
    if (!(scale > 0)) throw new Error('Схема дерева ще не готова до експорту.');
    for (const edge of scene.querySelectorAll('path.edge')) {
      const css = getComputedStyle(edge);
      element('path', {
        d: edge.getAttribute('d'), fill: 'none', stroke: css.stroke,
        'stroke-width': css.strokeWidth, 'stroke-linecap': css.strokeLinecap,
        'stroke-linejoin': css.strokeLinejoin, opacity: css.opacity,
        'stroke-dasharray': css.strokeDasharray
      }, parent);
    }
    const cards = new Map([...scene.querySelectorAll('.tile')].map(card => [card.dataset.personKey,card]));
    for (const node of layout.nodes) drawCard(parent, cards.get(node.key), node, scale, measure, forPrint);
    const labels = scene.querySelectorAll('.graph-label');
    layout.labels.forEach((position, i) => {
      const label = labels[i];
      // Labels pinned to the viewport return to their layout positions in the file.
      drawLines(parent, label, label.getBoundingClientRect(), position.x, position.y, scale, measure);
    });
  }

  function routeSection(parent, route, width, top, measure) {
    if (!route?.length) return top;
    text(parent, 'Шлях до основної особи', gutter, top + 15, 15, {'font-weight': 600});
    let x = gutter, y = top + 25;
    const gap = 32, height = 54;
    route.forEach(({name, role}, i) => {
      measure.font = '15px ' + sans;
      const nameWidth = measure.measureText(name).width;
      measure.font = '12px ' + sans;
      const cardWidth = Math.ceil(Math.max(nameWidth, role ? measure.measureText(role).width : 0)) + 24;
      if (x > gutter && x + cardWidth > width - gutter) { x = gutter; y += height + 8; }
      if (i && x > gutter) text(parent, '→', x - gap / 2, y + 33, 20, {fill: '#92533f', 'text-anchor': 'middle'});
      element('rect', {x, y, width: cardWidth, height, rx: 6, fill: '#fffef8', stroke: '#d2d8cb'}, parent);
      if (role) text(parent, role, x + 12, y + 20, 12, {fill: '#526258'});
      text(parent, name, x + 12, y + (role ? 40 : 33), 15);
      x += cardWidth + gap;
    });
    return y + height + 16;
  }

  function drawWings(parent, wings, width, split, headerY, height, labels) {
    const bands = [];
    if (wings === 'both' || wings === 'm') bands.push({key: 'm', left: 0, right: wings === 'm' ? width : split});
    if (wings === 'both' || wings === 'f') bands.push({key: 'f', left: wings === 'f' ? 0 : split, right: width});
    const headerHeight = bands.length ? 34 : 0;
    for (const {key, left, right} of bands) {
      const maternal = key === 'm';
      element('rect', {x: left, y: headerY, width: right-left, height: headerHeight,
        fill: maternal ? '#d5e5d6' : '#efd9d6'}, parent);
      element('rect', {x: left, y: headerY + headerHeight, width: right-left, height,
        fill: maternal ? '#f3f6ee' : '#fbf1ee'}, parent);
      text(parent, labels[key], (left+right)/2, headerY+22, 14, {
        'font-weight': 650, 'text-anchor': 'middle', fill: maternal ? '#284a36' : '#69383b'
      });
    }
    if (wings === 'both') element('rect', {
      x: split - 20, y: headerY + headerHeight, width: 40, height, fill: '#f9f7ef'
    }, parent);
    return headerHeight;
  }

  function build({scene, layout, title, route = [], forPrint = false, sourceLabel = '', wingLabels = {m:'Мамина лінія',f:'Татова лінія'}}) {
    const measure = document.createElement('canvas').getContext('2d');
    measure.font = '29px ' + serif;
    const titleWidth = measure.measureText(title).width;
    measure.font = '15px ' + sans;
    const longestName = Math.max(0,...route.map(step => measure.measureText(step.name).width + 24));
    const width = Math.ceil(Math.max(layout.width, titleWidth + gutter*2, longestName + gutter*2, 500));
    const svg = element('svg', {width, role: 'img', 'aria-label': title});
    const paper = element('rect', {x:0, y:0, width, fill:'#f9f8f1'}, svg);
    text(svg, title, gutter, 42, 29, {'font-family':serif});
    if (sourceLabel) text(svg, sourceLabel, gutter, 64, 15, {fill:'#526258'});
    const headerY = routeSection(svg, route, width, sourceLabel ? 82 : 60, measure);
    const graphX = (width - layout.width) / 2;
    const wings = scene.parentElement.dataset.wings;
    const graphY = headerY + drawWings(svg,wings,width,graphX + (layout.dividerX ?? layout.width / 2),
      headerY,layout.height,wingLabels);
    const graph = element('g', {transform:'translate('+graphX+' '+graphY+')'}, svg);
    drawGraph(graph, scene, layout, measure, forPrint);
    const legendY = graphY + layout.height + 21;
    let x = gutter;
    for (const [label,dash] of [['Батьки й діти',null],['Інша спорідненість','7 4'],['Потребує уточнення','1.2 5']]) {
      element('path', {d:'M'+x+' '+(legendY-4)+'h22', stroke:'#587362', 'stroke-width':2,
        'stroke-dasharray':dash,'stroke-linecap':'round'},svg);
      text(svg, label, x + 30, legendY, 12, {fill:'#526258'});
      measure.font = '12px ' + sans;
      x += 48 + measure.measureText(label).width;
    }
    const height = Math.ceil(legendY + 17);
    svg.setAttribute('height', height);
    svg.setAttribute('viewBox', [0, 0, width, height].join(' '));
    paper.setAttribute('height', height);
    return svg;
  }

  return {build};
})();
