'use strict';

(() => {
  const byId = id => document.getElementById(id);
  const data = window.FAMILY_TREE;
  const board = byId('board');
  const scene = byId('scene');
  const side = byId('side');
  const drawer = byId('personDrawer');
  const treePanel = side.parentElement;
  let currentTab = 'tree', geographyMap;
  let resetMapPerson = false;
  const mappedPersonIds = new Set((data?.geography?.events || []).map(event => event.personId));
  let returnToPerson = null;
  const mobilePanel = matchMedia('(max-width:760px), (orientation:landscape) and (pointer:coarse) and (max-height:540px)');
  const guide = byId('wingGuide');
  if (!data || !window.PersonEvidence || !window.LifeDates || !window.KinLayout || !window.AncestorNames || !window.TreeBranches || !window.Lineages || !window.Pedigree) {
    board.textContent = 'Не вдалося прочитати файли дерева. Перевір, чи папка app лежить поруч з index.html.';
    return;
  }

  const evidence = window.PersonEvidence.create(data);
  const people = new Map(data.people.map(person => [person.key, person]));
  function maidenLabel(person) {
    return person.maidenSurname ? '(Дівоче: ' + person.maidenSurname + ')' : '';
  }
  function displayName(person) {
    return [person.name, maidenLabel(person)].filter(Boolean).join(' ');
  }
  const links = new Map(data.people.map(person => [person.key, []]));
  for (const edge of data.edges) {
    links.get(edge.a).push(edge);
    links.get(edge.b).push(edge);
  }
  const rootKey = 'root';
  const branches = {m:'Материнська лінія', f:'Батьківська лінія', self:'Вихідна особа'};
  const tree = window.TreeBranches.create(data, rootKey);
  const lineages = window.Lineages.create(data);
  // Keep a meeting of two named families visible even when older generations are folded.
  const junctions = new Map();
  const sharedStems = new Set();
  for (const p of data.people) {
    const entries = new Map();
    const parentLines = new Set();
    for (const edge of links.get(p.key)) {
      if (edge.b !== p.key || !['parent','stepparent'].includes(edge.type)) continue;
      const group = lineages.forPerson(edge.a);
      if (edge.type === 'parent') parentLines.add(group?.id || people.get(edge.a).branch);
      if (group) {
        const label = edge.type === 'stepparent' ? group.label+' ('+(edge.roleA || 'вітчим або мачуха').toLocaleLowerCase('uk')+')' : group.label;
        entries.set(group.id,{group,label});
      }
    }
    if (parentLines.size > 1) sharedStems.add(p.key);
    if (entries.size > 1 && !lineages.forPerson(p.key)) junctions.set(p.key,[...entries.values()]);
  }
  const elem = (tag, text, cls) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  };
  const button = (text, onClick, cls) => {
    const node = elem('button', text, cls);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
  };
  const familyPhotos = window.FamilyPhotos.create(data, {elem, button, normalise, openSource});
  let mode = 'all', focusKey = rootKey, selected = null;
  let familyTree = null, familyRoute = [];
  let activeLineage = null;
  let sourceMode = 'all';
  const sourceLabels = {all:'Усі', memory:'Спогади', archive:'Архів'};
  const sourceDescriptions = {
    memory:'Є родинне свідчення або сімейний матеріал про цю людину',
    archive:'Цю людину впізнано в архівному документі'
  };
  let kind = 'everyone', baseKeys = new Set(), visible = new Set(), expanded = new Set();
  let baseGeneration;
  let layout = null, zoom = 1;
  let zoomOrigin = null, zoomIdleTimer;
  let compactClose = false;
  // A scrollbar can narrow the scrollport without changing the available panel.
  const needsCompactClose = () => kind === 'closeKin' && board.offsetWidth < 560;
  let returnView = null, treeNeedsRedraw = false;
  let sceneNodes = new Map(), drawnTree;
  let shownBranches = new Set();
  let wheelFrame = 0, pendingZoomLog = 0, lastWheelFrame = -Infinity, pinch = null;
  let lastWheelDirection = 0, wheelAllowance = .075, pointerX = 0, pointerY = 0;
  const opposite = (edge, key) => edge.a === key ? edge.b : edge.a;
  function relationName(edge, personKey) {
    const from = personKey === edge.a;
    const terms = {
      parent: from ? 'Діти' : 'Батьки',
      stepparent: from ? 'Пасинки й падчерки' : 'Вітчим або мачуха',
      spouse: 'Подружжя', sibling: 'Брати й сестри', other: 'Інші зв’язки з аркушів'
    };
    return terms[edge.type] || terms.other;
  }

  function extentSize(size, origin) {
    // Leave enough scroll range to keep the same point under the fingers even
    // when the diagram changes between fitting the viewport and overflowing it.
    if (origin < 0) return 'max(' + size + 'px, calc(100% + ' + (-origin) + 'px))';
    return (size + origin) + 'px';
  }
  function rescale(restoreZoomPoint = false) {
    if (!layout || board.hidden || byId('treeView').hidden) return;
    const width = layout.width * zoom;
    const height = layout.height * zoom;
    const extent = byId('extent');
    // When zoomed in, even an outermost row can be panned to the middle of the board.
    const verticalMargin = board.offsetHeight / 2;
    const verticalOrigin = zoomOrigin ? zoomOrigin.y - verticalMargin : 0;
    // CSS fills unused space so scrollbar rounding cannot feed back into the extent.
    extent.style.width = extentSize(width, zoomOrigin?.x ?? 0);
    extent.style.height = extentSize(height + 2 * verticalMargin, verticalOrigin);
    const viewWidth = board.clientWidth, guideWidth = board.offsetWidth;
    const left = zoomOrigin ? Math.max(0, zoomOrigin.x) : Math.max(0, (viewWidth - width) / 2);
    const top = verticalMargin + Math.max(0, verticalOrigin);
    scene.style.left = left + 'px';
    scene.style.top = top + 'px';
    scene.style.transform = 'scale(' + zoom + ')';
    const display = Math.round(zoom * 100) + '%';
    if (byId('scale').textContent !== display) byId('scale').textContent = display;
    if (restoreZoomPoint) {
      board.scrollTo(Math.max(0,-zoomOrigin.x), Math.max(0,-verticalOrigin));
      zoomOrigin.scrollX = board.scrollLeft;
      zoomOrigin.scrollY = board.scrollTop;
    }
    pinLabels(viewWidth, guideWidth, left, board.scrollLeft);
  }
  function center(key) {
    const box = sceneNodes.get(key);
    if (!box) return;
    board.scrollTo((box.x + box.w / 2) * zoom + parseFloat(scene.style.left) - board.clientWidth / 2,
                   (box.y + box.h / 2) * zoom + parseFloat(scene.style.top) - board.clientHeight / 2);
  }
  function fit(readable = false) {
    zoomOrigin = null;
    const exact = Math.min(1.08, (board.clientWidth - 4) / layout.width, (board.clientHeight - 4) / layout.height);
    const minimum = board.clientWidth >= 950 && layout.nodes.length <= 16 ? .73 : .80;
    zoom = readable ? Math.max(minimum, exact) : exact;
    rescale();
    if (readable && zoom > exact) center(mode === 'family' ? focusKey : rootKey);
    else board.scrollTo(0, parseFloat(scene.style.top) - (board.clientHeight - layout.height * zoom) / 2);
  }
  function onScreen(node, x, y, scale, width, height, fraction = 0) {
    const left = x + node.x*scale, top = y + node.y*scale;
    const w = node.w*scale, h = node.h*scale;
    return Math.min(width,left+w) - Math.max(0,left) > fraction*Math.min(w,width) &&
           Math.min(height,top+h) - Math.max(0,top) > fraction*Math.min(h,height);
  }
  function zoomCard(left, top, width, height, x, y, preferSelection) {
    let best, bestDistance = Infinity, bestVisible = false;
    for (const node of layout.nodes) {
      const visible = onScreen(node,left,top,zoom,width,height);
      if (visible && preferSelection && node.key === selected) return node;
      const dx = left+(node.x+node.w/2)*zoom-x, dy = top+(node.y+node.h/2)*zoom-y;
      const distance = dx*dx + dy*dy;
      if ((visible && !bestVisible) || (visible === bestVisible && distance < bestDistance)) {
        best = node; bestDistance = distance; bestVisible = visible;
      }
    }
    return best;
  }
  function magnify(factor, anchorX, anchorY) {
    if (!layout || byId('treeView').hidden) return;
    const width = board.clientWidth, height = board.clientHeight;
    const minZoom = Math.min(.10, (width - 4) / layout.width, (height - 4) / layout.height);
    const target = Math.max(minZoom, Math.min(2.5, zoom * factor));
    if (target === zoom) return;
    const fromToolbar = anchorX === undefined;
    if (fromToolbar) { anchorX = width/2; anchorY = height/2; }
    const scrollX = board.scrollLeft, scrollY = board.scrollTop;
    // Keep the fractional origin until the user actually pans. WebKit can round the scroll offset.
    const left = zoomOrigin?.scrollX === scrollX ? zoomOrigin.x : parseFloat(scene.style.left)-scrollX;
    const top = zoomOrigin?.scrollY === scrollY ? zoomOrigin.y : parseFloat(scene.style.top)-scrollY;
    const worldX = (anchorX-left)/zoom, worldY = (anchorY-top)/zoom;
    let nextX = anchorX - worldX*target;
    let nextY = anchorY - worldY*target;
    // A pinch over whitespace should still leave a readable part of a nearby card in frame.
    const losingCards = target > zoom && !fromToolbar &&
      !layout.nodes.some(node => onScreen(node,nextX,nextY,target,width,height,.5)) &&
      !layout.nodes.some(node => worldX >= node.x && worldX <= node.x+node.w &&
        worldY >= node.y && worldY <= node.y+node.h);
    if (fromToolbar || losingCards) {
      const node = zoomCard(left,top,width,height,anchorX,anchorY,fromToolbar);
      if (node) {
        const x = node.x+node.w/2, y = node.y+node.h/2;
        const visible = onScreen(node,left,top,zoom,width,height);
        const insetX = Math.min(32,width/2,node.w*target/2);
        const insetY = Math.min(32,height/2,node.h*target/2);
        const screenX = visible ? Math.max(insetX,Math.min(width-insetX,left+x*zoom)) : width/2;
        const screenY = visible ? Math.max(insetY,Math.min(height-insetY,top+y*zoom)) : height/2;
        nextX = screenX - x*target; nextY = screenY - y*target;
      }
    }
    zoomOrigin = {x:nextX,y:nextY};
    zoom = target;
    board.classList.add('zooming');
    clearTimeout(zoomIdleTimer);
    zoomIdleTimer = setTimeout(() => board.classList.remove('zooming'), 150);
    rescale(true);
  }

  const scope = () => mode === 'm' || mode === 'f' ? mode : 'all';
  const sameMembers = (first, second) => first.size === second.size && [...first].every(key => second.has(key));
  const generationNames = ['', 'До батьків', 'До дідусів і бабусь', 'До прадідів і прабабусь', 'До прапрадідів і прапрабабусь', 'До прапрапрадідів і прапрапрабабусь'];
  const generationDistance = key => Math.abs(people.get(key).level - people.get(rootKey).level);
  const displayedGeneration = () => sameMembers(visible,baseKeys) ? baseGeneration : null;

  function limitGeneration(value) {
    const eligible = tree.eligible(scope(),kind);
    if (value === 'all') return eligible;
    const depth = Number(value);
    const connected = new Set([rootKey]);
    // Walking only within the generation band keeps each person's path to Max visible.
    for (const key of connected) {
      for (const relative of tree.hiddenNeighbors(connected,key,scope(),kind)) {
        if (generationDistance(relative) <= depth) connected.add(relative);
      }
    }
    return connected;
  }

  function setGeneration(value) {
    const maxDepth = Math.max(1,...Array.from(tree.eligible(scope(),kind),generationDistance));
    resetMapPerson = true;
    baseGeneration = value === 'all' ? 'all' : String(Math.min(maxDepth,Number(value) || 2));
    baseKeys = limitGeneration(baseGeneration);
    expanded.clear();
    rebuildVisible();
  }

  function updateGenerationControl(eligible) {
    const picker = byId('generationDepth');
    const preset = displayedGeneration();
    const maxDepth = Math.max(1,...Array.from(eligible,generationDistance));
    const options = [];
    if (!preset) {
      const custom = new Option('Вибрані гілки','custom');
      custom.disabled = true;
      options.push(custom);
    }
    for (let depth = 1;depth <= maxDepth;depth++) {
      const name = generationNames[depth] || 'Поколінь від основної особи';
      options.push(new Option(depth+' · '+name,String(depth)));
    }
    options.push(new Option('Усі покоління','all'));
    picker.replaceChildren(...options);
    picker.value = preset === 'all' || !preset ? (preset || 'custom') : String(Math.min(Number(preset),maxDepth));
  }

  let guideGeometry = null, generationLabels = null, lastScrollLeft = null, lastWingWidth = null;
  function positionLabels(scrollLeft) {
    if (!guideGeometry || scrollLeft === lastScrollLeft) return;
    lastScrollLeft = scrollLeft;
    const {width, guideWidth, split, fixedLeft, sceneLeft} = guideGeometry;
    const visibleLeft = split === null ? fixedLeft : Math.max(0, Math.min(width, split - scrollLeft));
    if (visibleLeft !== lastWingWidth) {
      const left = guide.firstElementChild, right = guide.lastElementChild;
      // Slide the two colored strips and keep their names centered in the visible parts.
      left.style.transform = 'translateX(' + (visibleLeft - guideWidth) + 'px)';
      right.style.transform = 'translateX(' + visibleLeft + 'px)';
      left.firstElementChild.style.transform = 'translateX(' + (guideWidth-visibleLeft)/2 + 'px)';
      right.firstElementChild.style.transform = 'translateX(' + (-visibleLeft/2) + 'px)';
      left.hidden = visibleLeft < 1;
      right.hidden = width - visibleLeft < 1;
      left.classList.toggle('too-narrow', visibleLeft < 108);
      right.classList.toggle('too-narrow', width - visibleLeft < 108);
      lastWingWidth = visibleLeft;
    }
    if (generationLabels) {
      const offset = Math.max(0, (scrollLeft - sceneLeft + 12) / zoom - layout.labels[0].x);
      generationLabels.style.transform = 'translateX(' + offset + 'px)';
    }
  }
  function pinLabels(width, guideWidth, sceneLeft, scrollLeft) {
    if (!layout) return;
    const maternal = shownBranches.has('m'), paternal = shownBranches.has('f');
    const hasDivider = maternal && paternal && Number.isFinite(layout.dividerX);
    const split = hasDivider ? sceneLeft + layout.dividerX * zoom : null;
    const fixedLeft = !maternal ? 0 : paternal ? width / 2 : width;
    guideGeometry = {width, guideWidth, split, fixedLeft, sceneLeft};
    lastScrollLeft = lastWingWidth = null;
    guide.hidden = (!maternal && !paternal) || (mode === 'family' && maternal && paternal && !hasDivider);
    const extent = byId('extent');
    const wings = hasDivider ? 'both' : maternal && !paternal ? 'm' : paternal && !maternal ? 'f' : '';
    if (extent.dataset.wings !== wings) extent.dataset.wings = wings;
    if (hasDivider) extent.style.setProperty('--split-at', split + 'px');
    positionLabels(scrollLeft);
  }
  board.addEventListener('scroll', () => positionLabels(board.scrollLeft), {passive:true});

  function makeEvidenceBadges(kinds) {
    const marks = elem('span', undefined, 'evidence-marks');
    for (const kind of kinds) {
      const mark = elem('span',sourceLabels[kind]);
      mark.dataset.evidenceKind = kind;
      mark.title = sourceDescriptions[kind];
      marks.append(mark);
    }
    return marks;
  }

  function createSourceSwitch() {
    const group = elem('div', undefined, 'source-switch');
    group.setAttribute('role','group');
    group.setAttribute('aria-label','Джерела відомостей');
    group.append(elem('span','Джерела','switch-label'));
    for (const [value,label] of Object.entries(sourceLabels)) {
      const control = button(label, () => setSourceMode(value,control));
      control.dataset.sourceMode = value;
      control.setAttribute('aria-pressed',String(sourceMode === value));
      group.append(control);
    }
    return group;
  }

  function syncSourceView() {
    scene.dataset.sourceMode = sourceMode;
    let matching = 0;
    for (const card of scene.querySelectorAll('.tile')) {
      const matches = sourceMode === 'all' || evidence.forPerson(people.get(card.dataset.personKey))[sourceMode];
      card.classList.toggle('source-muted',!matches);
      const occupations = professionTags(people.get(card.dataset.personKey),sourceMode);
      card.title = [sourceMode === 'all' ? card.dataset.fullTitle : card.dataset.identityTitle,
        occupations.length ? 'Професія · '+occupations.join(', ') : ''].filter(Boolean).join(' · ');
      if (matches) matching++;
    }
    const count = byId('sourceCount');
    count.hidden = currentTab !== 'tree';
    count.textContent = sourceMode === 'all' ? '' : 'На схемі з '+(sourceMode === 'memory' ? 'родинними свідченнями' : 'архівним підтвердженням')+' · '+matching+' із '+sceneNodes.size;
    for (const control of document.querySelectorAll('button[data-source-mode]')) {
      control.setAttribute('aria-pressed',String(control.dataset.sourceMode === sourceMode));
    }
  }

  function setSourceMode(value, control) {
    if (value === sourceMode) return;
    const insideCard = side.contains(control);
    const left = board.scrollLeft, top = board.scrollTop;
    sourceMode = value;
    syncSourceView();
    syncMapFilters();
    byId('results').hidden = true;
    if (selected) {
      showPerson(selected);
      board.scrollTo(left,top);
      const trigger = insideCard ? side.querySelector('button[data-source-mode="'+value+'"]') : control;
      trigger?.focus({preventScroll:true});
    }
  }

  function updateControls() {
    for (const control of document.querySelectorAll('[data-scope]')) control.setAttribute('aria-pressed', control.dataset.scope === mode);
    for (const control of document.querySelectorAll('[data-kind]')) control.setAttribute('aria-pressed', control.dataset.kind === kind);
    byId('familyContext').hidden = mode !== 'family';
    byId('branchControls').hidden = mode === 'family';
    const eligible = tree.eligible(scope(),kind);
    if (currentTab === 'map') syncMapFilters();
    else byId('graphCount').textContent = 'На схемі ' + visible.size + ' із ' + eligible.size;
    syncSourceView();
    updateGenerationControl(eligible);
    byId('familyTitle').textContent = mode === 'family' ? 'Родина · ' + displayName(people.get(focusKey)) : '';
  }

  function showFamilyRoute() {
    const nav = byId('familyRoute');
    byId('familyLinkStatus').replaceChildren();
    nav.replaceChildren();
    nav.hidden = focusKey === rootKey;
    if (nav.hidden) return;
    if (!familyRoute.length) {
      nav.textContent = 'Шлях до основної особи поки не встановлено.';
      return;
    }
    const list = elem('ol');
    nav.append(elem('b','Шлях до основної особи'), list);
    for (const {key,edge,role} of familyRoute) {
      const step = button('', () => showPerson(key,true));
      if (edge) step.append(elem('small',role + (edge.uncertain ? ' · уточнити' : '')));
      step.append(document.createTextNode(displayName(people.get(key))));
      const item = elem('li');
      item.append(step); list.append(item);
    }
  }

  function markLineage(node, group) {
    node.dataset.lineage = group.id;
    node.dataset.lineageTone = group.side + String(group.tone);
  }

  function swatch(group) {
    const dot = elem('span',undefined,'lineage-swatch');
    markLineage(dot,group);
    dot.setAttribute('aria-hidden','true');
    return dot;
  }

  function applyLineageHighlight() {
    for (const node of scene.querySelectorAll('.tile,.edge,.branch-toggle')) {
      const match = node.dataset.lineage === activeLineage ||
        junctions.get(node.dataset.personKey)?.some(({group}) => group.id === activeLineage);
      node.classList.toggle('lineage-soft',Boolean(activeLineage && !match));
    }
    for (const choice of byId('lineageKey').querySelectorAll('button')) {
      choice.setAttribute('aria-pressed',String(choice.dataset.lineage === activeLineage));
    }
  }

  function drawLineageKey() {
    const available = new Set();
    for (const key of visible) {
      const family = lineages.forPerson(key);
      if (family) available.add(family.id);
      for (const {group} of junctions.get(key) || []) available.add(group.id);
    }
    const bar = byId('lineageKey');
    bar.hidden = !available.size;
    if (!available.has(activeLineage)) activeLineage = null;
    bar.replaceChildren(elem('span','Гілки'));
    for (const group of lineages.groups) {
      if (!available.has(group.id)) continue;
      const choice = button('',() => {
        resetMapPerson = true;
        activeLineage = activeLineage === group.id ? null : group.id;
        applyLineageHighlight();
        syncMapFilters();
        byId('results').hidden = true;
      },'lineage-choice');
      choice.append(swatch(group),document.createTextNode(group.label));
      choice.title = 'Підсвітити гілку · '+group.label;
      markLineage(choice,group);
      bar.append(choice);
    }
    applyLineageHighlight();
  }

  function rebuildVisible() {
    visible = new Set(baseKeys);
    for (const key of [...expanded]) {
      if (visible.has(key)) visible = tree.expand(visible,key,scope(),kind);
      else expanded.delete(key);
    }
  }
  function selectBranch(key) {
    resetMapPerson = true;
    const anchor = cardAnchor(key), before = new Set(sceneNodes.keys());
    if (expanded.has(key)) expanded.delete(key);
    else expanded.add(key);
    rebuildVisible();
    if (selected && !visible.has(selected)) closeSide();
    drawGraph({anchor});
    if (selected) showPerson(selected);
    const pivot = sceneNodes.get(key);
    const added = [...sceneNodes.values()].filter(n => !before.has(n.key));
    added.sort((a,b) => Math.hypot(a.x-pivot.x,a.y-pivot.y) - Math.hypot(b.x-pivot.x,b.y-pivot.y));
    if (added.length) revealPair(pivot,added[0]);
    const toggle = [...scene.querySelectorAll('.branch-toggle')].find(b => b.dataset.personKey === key);
    toggle?.focus({preventScroll:true});
  }
  function cardAnchor(key) {
    const node = sceneNodes.get(key);
    if (!node) return null;
    return {key, x:(node.x + node.w/2)*zoom + parseFloat(scene.style.left) - board.scrollLeft,
      y:(node.y + node.h/2)*zoom + parseFloat(scene.style.top) - board.scrollTop};
  }
  function restoreAnchor(anchor) {
    const current = cardAnchor(anchor.key);
    if (current) board.scrollBy(current.x - anchor.x,current.y - anchor.y);
  }
  function revealPair(a,b) {
    const gutter = 16;
    const adjust = (lo,hi,start,length) => hi - lo > length ? start : Math.max(hi-length, Math.min(start,lo));
    const x0 = parseFloat(scene.style.left), y0 = parseFloat(scene.style.top);
    const left = Math.min(a.x,b.x)*zoom + x0 - gutter, right = Math.max(a.x+a.w,b.x+b.w)*zoom + x0 + gutter;
    const top = Math.min(a.y,b.y)*zoom + y0 - gutter, bottom = Math.max(a.y+a.h,b.y+b.h)*zoom + y0 + gutter;
    board.scrollTo(adjust(left,right,board.scrollLeft,board.clientWidth),adjust(top,bottom,board.scrollTop,board.clientHeight));
  }

  function highlight() {
    const targets = [];
    if (selected && mode !== 'family') {
      if (kind === 'siblings' && selected === rootKey) {
        const {siblings,cousins} = tree.relatives(rootKey);
        targets.push(...[...siblings,...cousins].map(item=>item.key));
      } else targets.push(selected);
    }
    const steps = new Set(), keys = new Set();
    const familyEdges = new Set();
    if (mode === 'family') {
      for (const {key,edge} of familyRoute) {
        keys.add(key);
        if (edge) familyEdges.add(edge.id);
      }
    }
    for (const target of targets) {
      const route = visiblePathTo(target);
      route.forEach((key,i) => {
        keys.add(key);
        if (i) steps.add(JSON.stringify([route[i-1],key]));
      });
    }
    for (const card of scene.querySelectorAll('.tile')) {
      const active = card.dataset.personKey === selected;
      card.classList.toggle('sel', active);
      card.classList.toggle('on-route', keys.has(card.dataset.personKey) && !active);
      card.setAttribute('aria-pressed',active);
    }
    for (const path of scene.querySelectorAll('.edge')) {
      const {a,b} = path.dataset;
      const onRoute = familyEdges.has(path.dataset.edgeId) || steps.has(JSON.stringify([a,b])) || steps.has(JSON.stringify([b,a]));
      path.classList.toggle('traced', onRoute);
      path.classList.toggle('emphasis', Boolean(selected && (a === selected || b === selected)));
      path.classList.toggle('muted', Boolean(selected && !onRoute && a !== selected && b !== selected));
      if (onRoute || (selected && (a === selected || b === selected))) path.parentElement.append(path);
    }
  }

  // Following a single card's connectors is useful even before opening its notes.
  let hoveredKey = null;
  const incidentPaths = new Map();
  function previewConnections(key) {
    key = selected ? null : key || null;
    if (key === hoveredKey) return;
    for (const path of incidentPaths.get(hoveredKey) || []) path.classList.remove('preview-edge');
    hoveredKey = key;
    for (const path of incidentPaths.get(key) || []) path.classList.add('preview-edge');
  }
  for (const type of ['pointerover','focusin']) scene.addEventListener(type,event => {
    if (event.pointerType === 'touch') return;
    previewConnections(event.target.closest('.tile')?.dataset.personKey);
  });
  for (const type of ['pointerleave','focusout']) scene.addEventListener(type,event => {
    if (type === 'pointerleave' || !scene.contains(event.relatedTarget)) previewConnections(null);
  });
  function personFacts(p) {
    return [
      ['Місце народження', p.birthLocality],
      ['Національність', p.nationalities?.join(', ')],
      ['Походження', p.ancestries?.join(', ')]
    ].filter(([,value]) => value);
  }
  function professionTags(p, mode) {
    return [...new Set(evidence.professionsFor(p,mode).map(entry => entry.tag).filter(Boolean))];
  }
  function workTags(p) {
    const tags = professionTags(p,'all');
    if (!tags.length) return null;
    const row = elem('small', undefined, 'profession-tags');
    row.append(elem('span','Професія','profession-label'));
    const byKind = ['memory','archive'].map(mode => [mode,new Set(professionTags(p,mode))]);
    for (const name of tags) {
      const tag = elem('span',name,'profession-tag');
      for (const [mode,tagSet] of byKind) {
        if (tagSet.has(name)) {
          tag.dataset[mode] = '';
          row.dataset[mode] = '';
        }
      }
      row.append(tag);
    }
    return row;
  }
  function makePersonCard(p) {
    const {text:caption,ancestorKey} = (familyTree || tree).cardLabel(p.key);
    const name = cardName(p.name,caption);
    const card = button('', () => showPerson(p.key), 'tile ' + p.branch);
    const family = lineages.forPerson(p.key);
    const joins = junctions.get(p.key);
    if (family) markLineage(card,family);
    if (name.length > 32) card.classList.add('long');
    if (compactClose && p.level === people.get(rootKey).level-1) card.classList.add('compact-parent');
    card.dataset.generation = p.level;
    card.dataset.personKey = p.key;
    if (ancestorKey) card.dataset.ancestorKey = ancestorKey;
    card.append(elem('span', caption, 'relation'));
    const nameElement = elem('strong', name);
    const avatar = familyPhotos.avatar(p);
    if (avatar) {
      const row = elem('span',undefined,'tile-identity');
      row.append(avatar,nameElement);
      card.append(row);
    } else card.append(nameElement);
    if (p.maidenSurname) card.append(elem('small', maidenLabel(p), 'maiden-surname'));
    if (joins) {
      const marks = elem('span',undefined,'lineage-junction');
      for (const {group} of joins) marks.append(swatch(group));
      card.append(marks);
    }
    const dates = window.LifeDates.format(p);
    if (dates.text) card.append(elem('small', dates.text,'person-fact'));
    for (const [label,value] of personFacts(p)) {
      card.append(elem('small', label+' · '+value, 'person-fact'));
    }
    const work = workTags(p);
    if (work) card.append(work);
    const provenance = evidence.forPerson(p);
    const kinds = ['memory','archive'].filter(kind => provenance[kind]);
    if (kinds.length) card.append(makeEvidenceBadges(kinds));
    return card;
  }
  // Measure unscaled natural heights in a single layout pass. Card heights feed the
  // connectors as well as the buttons, including after a long or bilingual entry.
  const measuredSizes = new Map();
  function measureCards(width) {
    const cacheKey = width+' '+compactClose;
    if (!familyTree && measuredSizes.has(cacheKey)) return measuredSizes.get(cacheKey);
    const holder = elem('div',undefined,'card-measure');
    holder.style.width = width+'px';
    for (const p of data.people) {
      if (!familyTree || visible.has(p.key)) holder.append(makePersonCard(p));
    }
    board.append(holder);
    const heights = new Map(Array.from(holder.children, el => [el.dataset.personKey, el.offsetHeight]));
    holder.remove();
    if (!familyTree) measuredSizes.set(cacheKey, heights);
    return heights;
  }
  function familyGeneration(level) {
    const distance = level - people.get(focusKey).level;
    if (!distance) return 'Покоління вибраної людини';
    if (distance === -1) return 'Покоління батьків';
    if (distance === -2) return 'Покоління дідусів і бабусь';
    if (distance === 1) return 'Покоління дітей';
    if (distance === 2) return 'Покоління онуків';
    return 'Покоління ' + (distance > 0 ? '+' : '−') + Math.abs(distance);
  }

  function frameFamily() {
    const focus = sceneNodes.get(focusKey);
    const peers = tree.relatives(focusKey).siblings.map(s=>sceneNodes.get(s.key))
      .filter(node => node && node.level === focus.level);
    if (!peers.length) return;
    const left = Math.min(focus.x,...peers.map(n=>n.x));
    const right = Math.max(focus.x+focus.w,...peers.map(n=>n.x+n.w));
    const scale = Math.min(zoom,(board.clientWidth-18)/(right-left));
    if (scale < .7) return;
    zoom = scale; rescale(); center(focusKey);
    board.scrollLeft = (left+right)/2 * zoom + parseFloat(scene.style.left) - board.clientWidth/2;
  }
  function drawGraph({anchor=null, reset=false, origin=null} = {}) {
    clearWheel();
    if (currentTab !== 'tree') {
      treeNeedsRedraw = true;
      drawLineageKey();
      updateControls();
      return;
    }
    treeNeedsRedraw = false;
    zoomOrigin = origin;
    const edges = kind === 'everyone' ? data.edges : data.edges.filter(edge =>
      edge.type === 'parent' || (kind !== 'ancestors' && edge.type === 'sibling'));
    compactClose = needsCompactClose();
    const naturalHeights = measureCards(window.Pedigree.cardWidth);
    layout = window.Pedigree.layout({...data,edges}, {keys:visible,focus:focusKey,compact:compactClose,naturalHeights});
    sceneNodes = new Map(layout.nodes.map(node => [node.key, node]));
    shownBranches = new Set(layout.nodes.map(node => people.get(node.key).branch));
    hoveredKey = null;
    drawnTree = window.TreeBranches.create({people:layout.nodes.map(n=>people.get(n.key)),edges:layout.edges},rootKey);
    scene.replaceChildren();
    scene.classList.toggle('family-view',mode === 'family');
    scene.style.width = layout.width + 'px';
    scene.style.height = layout.height + 'px';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    incidentPaths.clear();
    svg.setAttribute('width', layout.width);
    svg.setAttribute('height', layout.height);
    svg.setAttribute('aria-hidden', 'true');
    for (const edge of layout.edges) {
      const path = document.createElementNS(svg.namespaceURI, 'path');
      path.setAttribute('d', edge.path);
      path.setAttribute('class', ['edge', edge.branch === 'f' ? 'f' : 'm', edge.type !== 'parent' && 'nonparent', edge.uncertain && 'uncertain'].filter(Boolean).join(' '));
      path.dataset.a = edge.a; path.dataset.b = edge.b;
      path.dataset.edgeId = edge.id;
      const from = lineages.forPerson(edge.a), to = lineages.forPerson(edge.b);
      // Co-parents share the last section of the connector. Use the side's line
      // at a merger so whichever parent was drawn last cannot recolor that section.
      const shared = (edge.type === 'parent' && sharedStems.has(edge.b)) || (from && to && from !== to);
      if (!shared && (from || to)) markLineage(path,from || to);
      svg.append(path);
      for (const key of [edge.a,edge.b]) {
        if (!incidentPaths.has(key)) incidentPaths.set(key, []);
        incidentPaths.get(key).push(path);
      }
    }
    scene.append(svg);
    // Extended views align their generation headings along one shared margin.
    generationLabels = layout.labels.length ? elem('div', undefined, 'generation-labels') : null;
    if (generationLabels) scene.append(generationLabels);
    for (const label of layout.labels) {
      const title = mode === 'family' && focusKey !== rootKey ? familyGeneration(label.level) : label.text;
      const text = elem('div', title, 'graph-label generation-marker');
      Object.assign(text.style,{left:label.x+'px',top:label.y+'px',width:label.w+'px'});
      (generationLabels || scene).append(text);
    }
    for (const node of layout.nodes) {
      const p = people.get(node.key);
      const card = makePersonCard(p);
      const family = lineages.forPerson(p.key);
      if (mode === 'family') card.classList.toggle('graph-focus', p.key === focusKey);
      Object.assign(card.style, {left:node.x+'px',top:node.y+'px',width:node.w+'px',height:node.h+'px'});
      const familyNames = family?.label || junctions.get(p.key)?.map(entry => entry.label).join(', ');
      card.dataset.identityTitle = [displayName(p), (familyTree || tree).cardLabel(p.key).text, familyNames].filter(Boolean).join(' · ');
      card.dataset.fullTitle = [card.dataset.identityTitle,window.LifeDates.format(p).detail,
        ...personFacts(p).map(([label,value]) => label+' · '+value)].filter(Boolean).join(' · ');
      scene.append(card);
      if (mode === 'family') continue;
      const hidden = tree.hiddenNeighbors(visible,p.key,scope(),kind);
      if (!hidden.length && !expanded.has(p.key)) continue;
      const opened = expanded.has(p.key);
      const toggle = button(opened ? '−' : '+' + hidden.length, () => selectBranch(p.key), 'branch-toggle');
      toggle.dataset.personKey = p.key;
      toggle.dataset.branch = p.branch;
      if (family) markLineage(toggle,family);
      toggle.setAttribute('aria-expanded', opened);
      toggle.title = (opened ? 'Згорнути гілку' : 'Розгорнути гілку') + ' · ' + displayName(p);
      toggle.setAttribute('aria-label',toggle.title);
      Object.assign(toggle.style,{left:(node.x+node.w-42)+'px',top:(node.y+node.h-13)+'px'});
      scene.append(toggle);
    }
    drawLineageKey();
    if (reset) {
      const wholeTree = mode === 'all' && kind === 'everyone' && displayedGeneration() === 'all';
      fit(!wholeTree);
      if (mode === 'family') frameFamily();
    }
    else {
      rescale();
      if (anchor) restoreAnchor(anchor);
    }
    highlight();
    updateControls();
  }
  function clearWheel() {
    if (wheelFrame) cancelAnimationFrame(wheelFrame);
    wheelFrame = 0; pendingZoomLog = 0; lastWheelFrame = -Infinity;
    releasePinch();
  }
  function setView(nextMode,key = rootKey,preset = 'all') {
    resetMapPerson = true;
    mode = nextMode; focusKey = key;
    byId('results').hidden = true;
    hidePersonPanel();
    expanded = new Set();
    familyTree = null; familyRoute = [];
    if (mode === 'family') {
      kind = 'everyone';
      activeLineage = null;
      familyRoute = tree.connectionToRoot(key);
      baseKeys = tree.familyMembers(key);
      for (const step of familyRoute) baseKeys.add(step.key);
      visible = new Set(baseKeys);
      familyTree = window.TreeBranches.create(data,key,{focused:true});
      baseGeneration = null;
      showFamilyRoute();
    } else {
      setGeneration(preset);
    }
    drawGraph({reset:true});
  }
  function exportTitle() {
    if (mode === 'family') return 'Родина · ' + displayName(people.get(focusKey));
    const titles = {all:'Родинне дерево',m:'Мамина лінія',f:'Татова лінія'};
    return (titles[mode] || 'Родинне дерево') + ' · Родинний архів';
  }

  function exportCurrentTree(forPrint = false) {
    const route = mode === 'family' && focusKey !== rootKey ? familyRoute.map(({key,edge,role}) => ({
      name:displayName(people.get(key)),
      role:edge ? role + (edge.uncertain ? ' · уточнити' : '') : ''
    })) : [];
    return window.TreeExportScene.build({
      scene, layout, title:exportTitle(), route, forPrint,
      sourceLabel:sourceMode === 'all' ? '' : 'Джерела · '+sourceLabels[sourceMode],
      wingLabels:{m:guide.querySelector('.m b').textContent, f:guide.querySelector('.f b').textContent}
    });
  }

  const exportControls = [...byId('graphControls').querySelectorAll('.tree-exports button')];
  for (const action of exportControls) {
    action.addEventListener('click', async () => {
      const status = byId('exportStatus');
      const pdf = action.id === 'exportPDF';
      const copy = action.id === 'copyPNG';
      exportControls.forEach(control => {control.disabled = true;});
      status.textContent = pdf ? 'Готуємо PDF…' : 'Готуємо зображення…';
      try {
        const svg = pdf ? exportCurrentTree(true) :
          Promise.resolve(familyPhotos.prepareLocalPng()).then(() => exportCurrentTree());
        const filename = exportTitle().replace(/ · /g,' — ');
        if (pdf) {
          await window.TreeExportPDF.save(svg, filename);
          status.textContent = '';
        } else if (copy) {
          await window.TreeExportPNG.copy(svg);
          status.textContent = 'Зображення скопійовано. Його можна вставити в повідомлення.';
        } else {
          await window.TreeExportPNG.download(await svg, filename);
          status.textContent = 'PNG готовий до завантаження.';
        }
      } catch (error) {
        const fallback = pdf ? 'Не вдалося підготувати PDF. Спробуйте ще раз.' :
          copy ? 'Не вдалося скопіювати. Натисніть PNG, щоб завантажити зображення.' : 'Не вдалося зберегти PNG. Спробуйте PDF.';
        status.textContent = error instanceof Error && /[А-Яа-яІіЇїЄє]/.test(error.message) ? error.message : fallback;
      } finally {
        exportControls.forEach(control => {control.disabled = false;});
      }
    });
  }

  function openFamily(key) {
    if (currentTab === 'map') switchTab('tree');
    if (mode !== 'family') {
      returnView = {mode,kind,baseGeneration,baseKeys:new Set(baseKeys),expanded:new Set(expanded),selected,activeLineage,zoom,zoomOrigin,scrollX:board.scrollLeft,scrollY:board.scrollTop};
    }
    setView('family',key);
  }
  function familyLinkTarget() {
    const target = mode === 'family' ? {family:people.get(focusKey).id} : {};
    if (sourceMode !== 'all') target.sources = sourceMode;
    return target;
  }
  async function copyTreeLink(target, feedback) {
    feedback.replaceChildren();
    try {
      await window.FamilyLinks.copy(target);
      feedback.textContent = 'Посилання скопійовано.';
    } catch (error) {
      feedback.textContent = error.message || 'Не вдалося скопіювати посилання.';
      if (error.url) {
        const field = elem('input');
        field.type = 'text';
        field.readOnly = true;
        field.setAttribute('aria-label','Посилання для ручного копіювання');
        field.value = error.url;
        feedback.append(field);
        field.focus({preventScroll:true});
        field.select();
      }
    }
  }
  byId('copyFamilyLink').onclick = () => copyTreeLink(familyLinkTarget(), byId('familyLinkStatus'));
  byId('returnView').onclick = () => {
    resetMapPerson = true;
    const back = returnView;
    returnView = null;
    if (!back) {
      setView('all',rootKey,'all');
      zoom = 1; rescale(); center(rootKey);
      return;
    }
    familyTree = null; familyRoute = [];
    mode = back.mode; kind = back.kind; baseKeys = back.baseKeys; expanded = back.expanded;
    activeLineage = back.activeLineage;
    baseGeneration = back.baseGeneration;
    hidePersonPanel(); focusKey = rootKey; zoom = back.zoom;
    rebuildVisible(); drawGraph({origin:back.zoomOrigin});
    if (back.selected) showPerson(back.selected);
    board.scrollTo(back.scrollX,back.scrollY);
  };
  function hidePersonPanel() {
    selected = null;
    returnToPerson = null;
    if (drawer.open) drawer.close();
    side.hidden = true;
  }
  function syncPersonPanel() {
    if (byId('sourceDialog').open || byId('familyPhotosDialog').open) return;
    if (!side.hidden && (currentTab === 'map' || (currentTab === 'tree' && mobilePanel.matches))) {
      if (!drawer.open) {
        drawer.append(side);
        drawer.showModal();
      }
    } else {
      if (drawer.open) drawer.close();
      if (side.parentElement === drawer) treePanel.append(side);
    }
  }
  mobilePanel.addEventListener('change', syncPersonPanel);
  byId('familyPhotosDialog').addEventListener('close', syncPersonPanel);
  drawer.addEventListener('cancel', event => {
    event.preventDefault();
    if (returnToPerson) returnToPerson();
    else closeSide();
  });
  side.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !drawer.open && returnToPerson && !byId('sourceDialog').open) {
      event.preventDefault();
      returnToPerson();
    }
  });
  drawer.addEventListener('click', event => {
    if (event.target === drawer) closeSide();
  });
  function closeSide() {
    clearWheel();
    hidePersonPanel();
    highlight(); rescale();
  }
  function includePaths(keys) {
    for (const key of keys) for (const step of tree.pathTo(key,scope(),kind)) baseKeys.add(step);
    rebuildVisible();
  }
  function visiblePathTo(key) {
    // The displayed close-kin graph already contains only eligible people and links.
    return drawnTree.pathTo(key,scope(),['closeKin','siblings'].includes(kind) ? 'everyone' : kind);
  }
  function locatePerson(key) {
    if (sceneNodes.has(key)) return;
    if (mode === 'family') byId('returnView').click();
    if (sceneNodes.has(key)) return;
    if (mode === 'family') mode = 'all';
    if (!tree.eligible(scope(),'everyone').has(key)) mode = 'all';
    if (!tree.eligible(scope(),kind).has(key)) kind = 'everyone';
    baseGeneration = null;
    includePaths([key]);
    drawGraph();
  }
  function closePersonButton() {
    const close = button('', closeSide, 'close');
    close.append(elem('span','Закрити ','close-label'), document.createTextNode('×'));
    close.setAttribute('aria-label','Закрити картку');
    return close;
  }

  function detailButton(p, title, render) {
    const trigger = button(title, () => {
      const overview = side.firstElementChild;
      const scrollTop = side.scrollTop;
      const page = elem('article', '', 'person-detail');
      const header = elem('header', '', 'person-header detail-header');
      const back = button('← До картки', () => returnToPerson(), 'detail-back');
      const heading = elem('h2',title);
      heading.id = 'personDetailTitle';
      header.append(closePersonButton(),back,elem('p',displayName(p),'meta'),heading);
      page.append(header);
      render(page);
      returnToPerson = () => {
        page.remove();
        overview.hidden = false;
        drawer.setAttribute('aria-labelledby','personName');
        side.scrollTop = scrollTop;
        trigger.focus({preventScroll:true});
        returnToPerson = null;
      };
      overview.hidden = true;
      side.append(page);
      drawer.setAttribute('aria-labelledby','personDetailTitle');
      side.scrollTop = 0;
      back.focus({preventScroll:true});
    }, 'detail-action');
    trigger.setAttribute('aria-label',title);
    return trigger;
  }

  function citationKey(ref) {
    return ref.source + '/' + (ref.seconds ?? '');
  }

  function historyCitations(history, professions) {
    const entries = new Map();
    const paragraphs = [...history.summary,...professions,...history.sections.flatMap(section => section.paragraphs)];
    for (const paragraph of paragraphs) {
      for (const ref of paragraph.refs || []) {
        const key = citationKey(ref);
        if (!entries.has(key)) entries.set(key,{...ref,number:entries.size + 1});
      }
    }
    return entries;
  }

  function citationTitle(ref) {
    const title = data.sources[ref.source].title;
    return ref.seconds == null ? title : title+' · '+timecode(ref.seconds);
  }

  function citationKind(p, index) {
    const proof = evidence.forPerson(p);
    if (proof.familyRefs.has(index)) return ['memory','Спогади'];
    if (proof.confirmed.has(index)) return ['archive','Архів'];
    if ((p.possibleArchives || []).includes(index)) return ['candidate','Можливий збіг'];
    if (data.sources[index].archive) return ['context','Архівний контекст'];
    return ['other','Родинний матеріал'];
  }

  function historyParagraph(p, paragraph, citations, node = elem('p')) {
    node.append(document.createTextNode(paragraph.text));
    let previousKind, group;
    for (const ref of paragraph.refs || []) {
      const [kind,label] = citationKind(p,ref.source);
      if (kind !== previousKind) {
        group = elem('span','','citation-group');
        group.dataset.citationKind = kind;
        if (sourceMode === 'all') group.append(elem('span',label,'citation-kind'));
        node.append(document.createTextNode(' '),group);
        previousKind = kind;
      }
      const {number} = citations.get(citationKey(ref));
      const link = button('['+number+']', () => openSource(ref.source,ref.seconds), 'footnote');
      link.title = label+' · '+citationTitle(ref);
      link.setAttribute('aria-label','Джерело '+number+' · '+link.title);
      const sup = elem('sup');
      sup.append(link);
      group.append(sup);
    }
    return node;
  }

  function appendBiography(overview, p, history, citations, professions) {
    const missing = !p.professions?.length ? 'Поки невідома.' :
      sourceMode === 'memory' ? 'У родинних свідченнях відомостей про фах немає.' :
      'У підтверджених архівних документах відомостей про фах немає.';
    const summary = elem('section', '', 'history-summary');
    summary.setAttribute('aria-label','Коротка біографія');
    for (const paragraph of history.summary) summary.append(historyParagraph(p,paragraph,citations));
    const work = elem('p', undefined, 'profession-summary');
    work.append(elem('b','Професія.'));
    const brief = professions.filter(entry => entry.summary);
    if (!brief.length && professions.length) brief.push(professions[0]);
    for (const entry of brief) {
      work.append(document.createTextNode(' '));
      historyParagraph(p,{text:entry.summary || entry.text,refs:entry.refs},citations,work);
    }
    if (!professions.length) work.append(document.createTextNode(' '+missing));
    summary.append(work);
    summary.append(detailButton(p,'Повна історія', page => {
      for (const section of history.sections) {
        page.append(elem('h3',section.title));
        for (const paragraph of section.paragraphs) page.append(historyParagraph(p,paragraph,citations));
      }
      page.append(elem('h3','Професія'));
      for (const entry of professions) page.append(historyParagraph(p,entry,citations));
      if (!professions.length) page.append(elem('p',missing));
      if (!citations.size) return;
      page.append(elem('h3','Джерела та примітки'));
      const notes = elem('ol','','history-notes');
      for (const ref of citations.values()) {
        const li = elem('li');
        const source = data.sources[ref.source];
        const [kind,label] = citationKind(p,ref.source);
        const refKind = elem('small',label,'citation-kind');
        refKind.dataset.citationKind = kind;
        li.append(refKind,button(citationTitle(ref), () => openSource(ref.source,ref.seconds), 'material-link'));
        const credit = sourceCredit(source);
        if (credit) li.append(elem('small',credit));
        notes.append(li);
      }
      page.append(notes);
    }));
    overview.append(summary);
  }

  function sourceCredit(source) {
    if (source.attribution) return source.attribution;
    const names = role => (source.contributors || []).filter(c => c.role === role)
      .map(c => people.get(c.key)?.name).filter(Boolean).join(', ');
    const narrator = names('narrator');
    if (narrator) return 'Розповідає · '+narrator;
    const primary = names('primary_informant'), other = names('informant');
    if (!primary && !other) return '';
    return ['Спогади для аркушів маминої лінії',
      primary && 'Основна розповідачка · '+primary,other && 'Спогадами також ділився · '+other].filter(Boolean).join('\n');
  }

  function appendFamilySources(overview, p, citations) {
    const memories = [...(p.memories || [])].sort((a,b) => a.source - b.source || a.seconds - b.seconds);
    const ids = new Set([...memories.map(m => m.source),...(p.refs || []),...[...citations.values()].map(ref => ref.source)]);
    const personalRefs = evidence.forPerson(p).familyRefs;
    const familyIds = [...ids].filter(n => sourceMode === 'memory' ? personalRefs.has(n) : !data.sources[n].archive);
    if (!familyIds.length) return;
    const section = elem('section', '', 'person-sources');
    section.append(elem('h3','Родинні свідчення та матеріали'));
    const list = elem('ul','','recordings');
    for (const n of familyIds) {
      const source = data.sources[n];
      const row = elem('li');
      const title = source.preview ? sourceLabel(n)+' · '+source.title : source.title;
      const read = button(title, () => openSource(n), 'recording-title');
      row.append(read);
      const credit = sourceCredit(source);
      if (credit) row.append(elem('p',credit,'source-byline'));
      if (source.originalVideo) {
        read.setAttribute('aria-label','Читати розшифровку · '+source.title);
        const watch = button('Дивитися відео', () => openSource(n,0));
        watch.setAttribute('aria-label','Дивитися відео · '+source.title);
        const actions = elem('div','','recording-actions');
        actions.append(watch,markdownLink(source));
        row.append(actions);
      }
      const episodes = memories.filter(m => m.source === n);
      if (episodes.length) {
        const clips = elem('ul','','memory-list');
        for (const m of episodes) {
          const time = timecode(m.seconds);
          const watch = button(time, () => openSource(n,m.seconds), 'memory-time');
          watch.setAttribute('aria-label','Відтворити з '+time+' · '+source.title+' · '+m.text);
          const clip = elem('li');
          clip.append(watch,elem('span',m.text));
          clips.append(clip);
        }
        row.append(clips);
      }
      list.append(row);
    }
    section.append(list);
    overview.append(section);
  }

  function appendArchives(overview, p) {
    const confirmed = evidence.forPerson(p).confirmed;
    const candidates = new Set(p.possibleArchives || []);
    const archives = (p.refs || []).filter(n => data.sources[n].archive);
    const section = elem('section', '', 'person-archives');
    section.append(elem('h3','Архівні джерела'));
    const groups = [
      ['Підтверджені документи про цю людину', archives.filter(n => confirmed.has(n))]
    ];
    if (sourceMode === 'all') groups.push(
      ['Документи про родину та місця пошуку', archives.filter(n => !confirmed.has(n) && !candidates.has(n))],
      ['Можливі збіги', archives.filter(n => !confirmed.has(n) && candidates.has(n))]
    );
    if (sourceMode === 'archive' && !confirmed.size) {
      section.append(elem('p','Архівного документа, у якому вдалося впізнати цю людину, поки немає.','source-empty'));
    }
    for (const [title,sources] of groups) {
      if (!sources.length) continue;
      section.append(elem('h4',title,'archive-group'));
      const list = elem('ul','','recordings');
      for (const n of sources) {
        const source = data.sources[n];
        const item = elem('li');
        item.append(elem('h5',source.title,'memory-source'));
        if (p.archiveNotes?.[n]) item.append(elem('p',p.archiveNotes[n],'archive-note'));
        addArchiveDetails(item,source);
        list.append(item);
      }
      section.append(list);
    }
    section.append(detailButton(p,'Перевірені архіви', page => appendSearchLog(page,p.searches || [])));
    overview.append(section);
  }

  function appendSearchLog(page, searches) {
    if (!searches.length) {
      page.append(elem('p','У журналі пошуку ще немає перевірених архівів без збігу для цієї людини.'));
      return;
    }
    const groups = [
      ['Переглянуті матеріали без збігу',searches.filter(s => ['not-found','partial'].includes(s.status))],
      ['Перевірено лише каталоги й покажчики',searches.filter(s => s.status === 'catalog-only')],
      ['Матеріали, до яких не було доступу',searches.filter(s => s.status === 'access-blocked')]
    ];
    for (const [title,entries] of groups) {
      if (!entries.length) continue;
      const group = elem('section', '', 'search-group');
      group.append(elem('h3',title));
      for (const search of entries) group.append(searchEntry(search));
      page.append(group);
    }
  }

  function searchEntry(search) {
    const entry = elem('section', '', 'search-entry');
    entry.append(elem('h4',search.title));
    const list = elem('dl');
    for (const [label,value] of [['Що шукали',search.query],['Де перевіряли',search.scope],
      ['Результат',search.result],['Межі перевірки',search.limitation]]) {
      if (value) list.append(elem('dt',label),elem('dd',value));
    }
    entry.append(list);
    if (search.urls?.length) {
      const links = elem('div','','recording-actions');
      for (const url of search.urls) {
        if (!/^https?:\/\//i.test(url)) continue;
        const link = elem('a');
        link.href = url;
        link.textContent = link.hostname + (search.urls.length > 1 ? ' · '+(links.childElementCount+1) : '');
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        links.append(link);
      }
      entry.append(links);
    }
    return entry;
  }

  function showPerson(key, locate = false) {
    const p = people.get(key);
    if (!p) return;
    clearWheel();
    const navigateMap = currentTab === 'tree' && locate && !drawer.open;
    if (navigateMap) locatePerson(key);
    if (navigateMap && activeLineage && lineages.forPerson(key)?.id !== activeLineage &&
        !junctions.get(key)?.some(({group}) => group.id === activeLineage)) {
      activeLineage = null;
      applyLineageHighlight();
    }
    selected = key;
    previewConnections(null);
    side.hidden = false;
    const label = (familyTree || tree).cardLabel(key);
    const tag = elem('p', '', 'tag');
    if (label.ancestorKey) {
      const link = button(label.text,()=>showPerson(label.ancestorKey,true),'ancestor-link');
      link.title = 'Перейти до картки · '+displayName(people.get(label.ancestorKey));
      tag.append(link);
    } else tag.textContent = label.text;
    const header = elem('header', undefined, 'person-header');
    const close = closePersonButton();
    const name = elem('h2', displayName(p));
    name.id = 'personName';
    header.append(close, tag, name);
    const proof = evidence.forPerson(p);
    const kinds = ['memory','archive'].filter(kind => proof[kind]);
    if (kinds.length) header.append(makeEvidenceBadges(kinds));
    const overview = elem('div', '', 'person-overview');
    returnToPerson = null;
    drawer.setAttribute('aria-labelledby', 'personName');
    side.replaceChildren(overview);
    overview.append(header);
    if (sourceMode !== 'archive') {
      const photos = familyPhotos.personStrip(p);
      if (photos) overview.append(photos);
    }
    const actions = elem('div', '', 'card-actions');
    if (mode !== 'family' || focusKey !== key) {
      actions.append(button('Родина цієї людини', () => openFamily(key), 'family-action'));
    }
    const inLineage = !activeLineage || lineages.forPerson(key)?.id === activeLineage ||
      junctions.get(key)?.some(({group}) => group.id === activeLineage);
    if (inLineage && visible.has(key) && data.geography?.events.some(event => event.personId === p.id &&
        (sourceMode === 'all' || evidence.forMapEvent(p,event)[sourceMode].length))) {
      actions.append(button('Місця цієї людини', () => switchTab('map',{personId:p.id})));
    }
    const feedback = elem('span','','share-feedback');
    feedback.setAttribute('role','status');
    const copyLink = button('Скопіювати посилання на картку', () =>
      copyTreeLink({...familyLinkTarget(),person:p.id}, feedback));
    copyLink.id = 'copyPersonLink';
    actions.append(copyLink, feedback);
    overview.append(actions,createSourceSwitch());
    const history = evidence.historyFor(p,sourceMode);
    const professions = evidence.professionsFor(p,sourceMode);
    const citations = historyCitations(history,professions);
    appendBiography(overview, p, history, citations,professions);
    if (sourceMode !== 'archive') appendFamilySources(overview, p, citations);
    if (sourceMode === 'memory' && !proof.memory) {
      overview.append(elem('p','Родинних спогадів про цю людину поки не записано.','source-empty'));
    }
    if (sourceMode !== 'memory') appendArchives(overview, p);
    overview.append(elem('h3',sourceMode === 'all' ? 'Відомості та спорідненість' : 'Родинні зв’язки на схемі'));
    const lineage = lineages.forPerson(key);
    const memberships = lineage ? [{group:lineage,label:lineage.label}] : junctions.get(key) || [];
    if (memberships.length) {
      const row = elem('p',memberships.length === 1 ? 'Гілка · ' : 'Гілки · ','person-lineage');
      for (const {group,label} of memberships) {
        const member = elem('span');
        member.append(swatch(group),document.createTextNode(label));
        row.append(member);
      }
      overview.append(row);
    }
    const fullCaption = tree.caption(key);
    if (fullCaption && (fullCaption !== label.text || (mode === 'family' && focusKey !== rootKey))) {
      const relation = elem('p');
      relation.append(elem('b','Спорідненість із основною особою · '),document.createTextNode(fullCaption));
      overview.append(relation);
    }
    const shared = (familyTree || tree).commonAncestors(key);
    if (shared.length) {
      const source = elem('p', '', 'shared-ancestor');
      source.append(elem('b',shared.length === 1 ? 'Спільний предок · ' : 'Спільні предки · '));
      shared.forEach((ancestor,i) => {
        if (i) source.append(document.createTextNode(', '));
        source.append(button(displayName(people.get(ancestor)),()=>showPerson(ancestor,true),'ancestor-link'));
      });
      overview.append(source);
    }
    if (sourceMode === 'all') {
      const dates = window.LifeDates.format(p);
      for (const [label,value] of [['Народження',dates.birth],['Смерть',dates.death],...personFacts(p),
        ['Місця в записах',p.place && p.place !== p.birthLocality && p.place],['Варіанти імені',p.alias !== p.name && p.alias]]) {
        if (!value) continue;
        const row = elem('p'); row.append(elem('b', label+' · '), document.createTextNode(value)); overview.append(row);
      }
    }
    const family = tree.relatives(key);
    function appendFamilyEntries(title,entries) {
      overview.append(elem('h3',title));
      if (!entries.length) {
        overview.append(elem('p','Відомостей у записах поки немає.','meta'));
        return;
      }
      const list = elem('ul','','relatives');
      for (const entry of entries) {
        const item = elem('li');
        const relative = button('',()=>showPerson(entry.key,true),'relative');
        relative.append(elem('b',displayName(people.get(entry.key))));
        const caption = key === rootKey ? tree.caption(entry.key) : '';
        if (caption) relative.append(elem('small',caption));
        if (entry.uncertain) relative.append(elem('small','Ланку спорідненості потрібно уточнити.'));
        item.append(relative); list.append(item);
      }
      overview.append(list);
    }
    if (key === rootKey) {
      appendFamilyEntries('Рідні брати й сестри',family.siblings);
      const unresolved = family.cousins.filter(entry => entry.uncertain && tree.caption(entry.key).startsWith('Можлив'));
      const pending = new Set(unresolved.map(entry=>entry.key));
      appendFamilyEntries('Двоюрідні брати й сестри',family.cousins.filter(entry=>!pending.has(entry.key)));
      if (unresolved.length) appendFamilyEntries('Спорідненість уточнюється',unresolved);
    } else {
      const inferred = family.siblings.filter(entry => !links.get(key).some(edge => edge.type === 'sibling' && opposite(edge,key) === entry.key));
      if (inferred.length) appendFamilyEntries('Брати й сестри за спільними батьками',inferred);
      const chain = visiblePathTo(key);
      if (chain.length > 1 && mode !== 'family') {
        overview.append(elem('h3','Як проходить зв’язок від основної особи'));
        const list = elem('ol','','route-list');
        chain.forEach((step,i) => {
          const li = elem('li');
          if (i) {
            const last = chain[i-1];
            const link = layout.edges.find(edge=>(edge.a===last && edge.b===step) || (edge.a===step && edge.b===last));
            const term = last === link.a ? link.roleB : link.roleA;
            const generic = {parent:last === link.a ? 'Дитина' : 'Один із батьків', sibling:'Брат або сестра', spouse:'Подружжя',stepparent:'Нерідне батьківство',other:'Зв’язок з аркуша'};
            li.append(elem('small',(term || generic[link.type])+(link.uncertain ? ' · уточнити' : '')));
          }
          li.append(button(displayName(people.get(step)),()=>showPerson(step,true),'route-step'));
          list.append(li);
        });
        overview.append(list);
      }
    }
    if (sourceMode === 'all' && p.notes) overview.append(elem('h3', 'Примітки'), elem('p', p.notes, 'details-text'));
    const groups = new Map();
    for (const e of links.get(key)) {
      const name = relationName(e, key);
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(e);
    }
    for (const [role, edges] of groups) {
      overview.append(elem('h3', role));
      const list = elem('ul', '', 'relatives');
      for (const edge of edges) {
        const relative = people.get(opposite(edge,key));
        const b = button('', () => showPerson(relative.key,true), 'relative');
        b.append(elem('b', displayName(relative)));
        const qualified = key === edge.a ? edge.roleB : edge.roleA;
        if (qualified) b.append(elem('small', qualified));
        if (edge.uncertain) b.append(elem('small','Потребує уточнення'));
        if (sourceMode === 'all' && edge.note) b.append(elem('small',edge.note));
        const li = elem('li');
        li.append(b);
        if (sourceMode === 'all' && edge.uncertain && edge.refs?.length) {
          const evidence = elem('div', '', 'subsources edge-sources');
          for (const n of edge.refs) evidence.append(button(sourceLabel(n), () => openSource(n)));
          li.append(evidence);
        }
        list.append(li);
      }
      overview.append(list);
    }
    syncPersonPanel();
    if (drawer.open) close.focus({preventScroll:true});
    side.scrollTop = 0;
    highlight();
    if (drawer.open && !navigateMap) return;
    rescale();
    const card = scene.querySelector('.tile.sel')?.getBoundingClientRect();
    const bounds = board.getBoundingClientRect();
    if (navigateMap || (card && (card.right > bounds.right || card.left < bounds.left || card.bottom > bounds.bottom || card.top < bounds.top))) center(key);
  }

  function normalise(value) {
    return String(value || '').toLocaleLowerCase('uk').normalize('NFKC').replace(/['’ʼ`]/g,'').replace(/ё/g,'е');
  }
  function cardName(name,caption) {
    const comma = name.lastIndexOf(', ');
    if (comma < 0) return name;
    const qualifier = name.slice(comma + 2);
    return normalise(qualifier) === normalise(caption.split(' · ')[0]) ? name.slice(0,comma) : name;
  }
  function find() {
    const input = byId('search');
    const results = byId('results');
    const q = normalise(input.value).trim();
    results.replaceChildren();
    results.hidden = !q;
    if (!q) return;
    const words = q.split(/\s+/);
    const perspective = familyTree || tree;
    const mapIds = currentTab === 'map' ? geographyMap.searchableIds() : null;
    const ranked = data.people.filter(p => !mapIds || mapIds.has(p.id)).map(p => {
      const name = normalise([p.name, p.maidenSurname, p.alias].join(' '));
      const professions = evidence.professionsFor(p,sourceMode).flatMap(entry => [entry.tag,entry.summary,entry.text]);
      const all = name + ' ' + normalise([...professions,perspective.cardLabel(p.key).text,perspective.caption(p.key),p.notes,p.place,p.born,p.died,
        ...personFacts(p).flat(),lineages.forPerson(p.key)?.label,...(p.memories || []).map(m => m.text),familyPhotos.keywords(p)].join(' '));
      return {p,score: words.every(w=>name.includes(w)) ? 1 : words.every(w=>all.includes(w)) ? 2 : 3};
    }).filter(x=>x.score<3).sort((a,b)=>a.score-b.score);
    if (!ranked.length) results.append(elem('p','Збігів не знайдено.'));
    for (const {p} of ranked) {
      const b = button(displayName(p), () => {
        results.hidden = true; input.value = '';
        if (currentTab === 'map') syncMapFilters({personId:p.id});
        else showPerson(p.key,true);
      });
      const dates = window.LifeDates.format(p);
      b.append(elem('small',[perspective.cardLabel(p.key).text,branches[p.branch],lineages.forPerson(p.key)?.label,dates.text,
        ...personFacts(p).map(([label,value]) => label+' · '+value),...professionTags(p,sourceMode)].filter(Boolean).join(' · ')));
      results.append(b);
    }
  }
  function sourceLabel(n) {
    const source = data.sources[n];
    if (source.preview) return 'Фото '+n;
    return n === 0 ? 'Зі слів основної особи' : source.title;
  }
  function markdownLink(source) {
    const link = elem('a','Завантажити .md');
    if (!source.markdownUrl && source.markdown) {
      source.markdownUrl = URL.createObjectURL(new Blob([source.markdown], {type:'text/markdown;charset=utf-8'}));
    }
    link.href = source.markdownUrl || source.path;
    link.download = source.path.split('/').pop();
    link.setAttribute('aria-label','Завантажити Markdown · '+source.title);
    return link;
  }

  async function localArchiveBlob(source) {
    const script = document.createElement('script');
    script.src = source.path + '.js';
    try {
      await new Promise((resolve, reject) => {
        script.onload = resolve;
        script.onerror = reject;
        document.head.append(script);
      });
      const binary = atob(script.archiveBytes);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new Blob([bytes], {type:source.archive.mime});
    } finally {
      script.remove();
    }
  }

  function addArchiveDetails(body, source) {
    const archive = source.archive;
    const type = archive.kind === 'archive-finding-aid' ? 'Архівний довідник' : 'Архівний документ';
    body.append(elem('p',[type,archive.repository,archive.reference].filter(Boolean).join(' · '),'meta'),
                elem('p',archive.summary));
    const actions = elem('div','','recording-actions');
    const original = elem('a','Перейти до архіву');
    original.href = archive.url;
    original.target = '_blank';
    original.rel = 'noopener noreferrer';
    original.setAttribute('aria-label','Перейти до архіву · '+source.title);
    const extension = archive.filename.split('.').pop().toUpperCase();
    const status = elem('p','','recording-status');
    status.setAttribute('role','status');
    const download = button('Завантажити '+extension, async () => {
      download.disabled = true;
      status.textContent = 'Завантаження…';
      try {
        const blob = window.familyArchiveBlob
          ? await window.familyArchiveBlob(archive, fraction => {status.textContent = 'Завантаження · '+Math.round(fraction*100)+'%';})
          : await localArchiveBlob(source);
        const save = elem('a');
        save.href = URL.createObjectURL(blob);
        save.download = archive.filename;
        document.body.append(save);
        save.click();
        save.remove();
        setTimeout(() => URL.revokeObjectURL(save.href), 60000);
        status.textContent = '';
      } catch {
        status.textContent = 'Не вдалося завантажити копію. Спробуй ще раз або відкрий посилання на архів.';
      } finally {
        download.disabled = false;
      }
    });
    download.setAttribute('aria-label','Завантажити '+extension+' · '+source.title);
    actions.append(original,download);
    body.append(actions,status);
  }

  let releaseVideo;
  function stopSourceVideo() {
    if (releaseVideo) releaseVideo();
    releaseVideo = null;
  }

  function timecode(seconds) {
    return [Math.floor(seconds / 60), seconds % 60].map(part => String(part).padStart(2,'0')).join(':');
  }

  function addRecording(body, source, startSeconds) {
    const player = elem('video', undefined, 'recording-player');
    player.controls = true;
    player.playsInline = true;
    player.preload = 'metadata';
    player.hidden = true;
    player.setAttribute('aria-label', source.title);
    const status = elem('p','','recording-status');
    status.setAttribute('role','status');
    const progress = elem('progress');
    progress.max = 1;
    progress.hidden = true;
    progress.setAttribute('aria-label','Завантаження відео');
    const download = elem('a','Завантажити оригінал (.mp4)');
    download.download = source.originalVideo.split('/').pop();
    const hosted = typeof window.familyVideoBlob === 'function';
    download.hidden = hosted;
    if (!hosted) {
      download.textContent = 'Відкрити оригінал (.mp4)';
      download.removeAttribute('download');
      download.href = source.originalVideo;
      download.target = '_blank';
      download.rel = 'noopener';
    }

    const controller = new AbortController();
    let objectUrl;
    const watch = button('Дивитися відео', start);
    async function start() {
      watch.disabled = true;
      status.textContent = '';
      let url = source.originalVideo;
      if (hosted) {
        progress.value = 0;
        progress.hidden = false;
        status.textContent = 'Завантаження відео…';
        try {
          const blob = await window.familyVideoBlob(source, fraction => {
            if (!controller.signal.aborted) progress.value = fraction;
          }, controller.signal);
          if (controller.signal.aborted) return;
          url = objectUrl = URL.createObjectURL(blob);
          download.href = url;
          download.hidden = false;
        } catch {
          if (controller.signal.aborted) return;
          progress.hidden = true;
          status.textContent = 'Не вдалося завантажити відео. Спробуй ще раз.';
          watch.disabled = false;
          return;
        }
      }
      status.textContent = '';
      progress.hidden = watch.hidden = true;
      player.hidden = false;
      if (startSeconds > 0) {
        player.addEventListener('loadedmetadata', () => {
          player.currentTime = startSeconds;
        }, {once:true, signal:controller.signal});
      }
      player.src = url;
      player.play().catch(error => {
        if (!controller.signal.aborted && error.name === 'NotAllowedError') {
          status.textContent = 'Натисни ▶ у програвачі, щоб почати відтворення.';
          player.addEventListener('playing', () => {status.textContent = '';}, {once:true, signal:controller.signal});
        }
      });
    }
    player.onerror = () => {
      status.textContent = 'Не вдалося відтворити відео. Можна завантажити оригінал.';
    };
    releaseVideo = () => {
      controller.abort();
      player.onerror = null;
      player.pause();
      player.removeAttribute('src');
      player.load();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    const actions = elem('div','','recording-actions');
    actions.append(watch, download, markdownLink(source));
    body.append(player, actions, status, progress);
    if (startSeconds !== null) start();
  }

  function openSource(n, startSeconds = null) {
    stopSourceVideo();
    const source = data.sources[n];
    const body = byId('sourceBody');
    body.replaceChildren(elem('h2',source.preview ? sourceLabel(n)+' · '+source.title : source.title));
    if (source.archive) addArchiveDetails(body, source);
    const credit = sourceCredit(source);
    if (credit) body.append(elem('p',credit,'recording-credit'));
    if (source.originalVideo) {
      addRecording(body, source, startSeconds);
      body.append(elem('h3','Розшифровка'));
    }
    const personalPhoto = source.kind === 'family-photograph' && /^https:\/\/photos\.google\.com\/photo\/[A-Za-z0-9_-]+$/.test(source.path);
    const personalGroup = source.kind === 'family-photo-group' && /^https:\/\/photos\.google\.com\/search\/[A-Za-z0-9_+=%-]+$/.test(source.path);
    if (personalPhoto || personalGroup) {
      const link = elem('a', personalGroup ? 'Відкрити групу в Google Фото' : 'Відкрити в Google Фото');
      link.href = source.path;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      body.append(link);
      if (personalGroup) {
        const peoplePage = elem('p');
        const peopleLink = elem('a','Відкрити «Люди й домашні тварини»');
        peopleLink.href = 'https://photos.google.com/people';
        peopleLink.target = '_blank';
        peopleLink.rel = 'noopener noreferrer';
        peoplePage.append(peopleLink);
        body.append(peoplePage);
      }
    }
    if (source.preview) {
      const original = elem('a'); original.href=source.path; original.target='_blank'; original.rel='noopener';
      const image = document.createElement('img'); image.src=source.page || source.path; image.alt=source.title;
      original.append(image); body.append(original);
      const link=elem('a','Відкрити оригінал');link.href=source.path;link.target='_blank';link.rel='noopener';
      body.append(link,elem('h3','Розшифровка та примітки'));
    }
    body.append(elem('pre',source.text));
    const dialog = byId('sourceDialog');
    if (!dialog.open) dialog.showModal();
    dialog.scrollTop = 0;
  }
  function createGeographyMap() {
    const geography = data.geography || {events:[],places:[]};
    const byPersonId = new Map(data.people.map(p => [p.id,p]));
    const sourceIndex = new Map(data.sources.map((source,index) => [source.id,index]));
    const sideColors = [
      {id:'m',side:'m',label:'Материнська лінія',color:'#48735c'},
      {id:'f',side:'f',label:'Батьківська лінія',color:'#9f5054'},
      {id:'self',side:'self',label:'Основна особа',color:'#244e40'}
    ];
    // Read the same palette as the tree so adding a lineage doesn't require a second colour table.
    const colors = lineages.groups.map(group => {
      const sample = swatch(group);
      byId('geoView').append(sample);
      const color = getComputedStyle(sample).getPropertyValue('--family-ink').trim();
      sample.remove();
      return {id:group.id,side:group.side,label:group.label,color};
    }).concat(sideColors);
    const events = geography.events.map(event => {
      const p = byPersonId.get(event.personId);
      const group = lineages.forPerson(p.key);
      const memberships = group ? [group.id] : (junctions.get(p.key) || []).map(({group:g}) => g.id);
      return {...event,branch:group?.id || p.branch,branches:memberships,side:p.branch,
        sourceIdsByMode:evidence.forMapEvent(p,event)};
    });
    return window.FamilyMap.create(byId('geoView'),{
      places:geography.places, events, colors,
      people:data.people.map(p => ({id:p.id,name:displayName(p)})),
      sourceTitles:Object.fromEntries(data.sources.map(s => [s.id,s.title])),
      onSummary:text => {if (currentTab === 'map') byId('graphCount').textContent = text;},
      openPerson:id => showPerson(byPersonId.get(id)?.key),
      openSource:id => {if (sourceIndex.has(id)) openSource(sourceIndex.get(id));}
    });
  }
  function syncMapFilters(focus = {}) {
    if (currentTab !== 'map' || !geographyMap) return;
    geographyMap.show({personIds:new Set([...visible].map(key => people.get(key).id)),
      sourceMode,lineage:activeLineage,...(resetMapPerson ? {personId:''} : {}),...focus});
    resetMapPerson = false;
  }
  function switchTab(next, mapFocus) {
    clearWheel();
    if ((next !== currentTab && [next,currentTab].includes('map')) || mapFocus) hidePersonPanel();
    currentTab = next;
    byId('viewFilters').hidden = next === 'album';
    byId('results').hidden = true;
    for (const [id,view] of [['tree','treeView'],['map','geoView'],['album','album']]) {
      byId(view).hidden = next !== id;
      byId(id+'Tab').setAttribute('aria-pressed', String(next === id));
    }
    syncPersonPanel();
    if (next === 'tree') {
      if (treeNeedsRedraw) drawGraph({reset:true});
      else {rescale();updateControls();}
    }
    if (next === 'map') {
      if (!geographyMap) geographyMap = createGeographyMap();
      syncMapFilters(mapFocus);
      geographyMap.resize();
      syncSourceView();
    }
  }
  const gallery = byId('gallery');
  data.sources.forEach((s,n) => {
    if (!n || !s.preview || familyPhotos.sourceIds.has(s.id)) return;
    const b=button('',()=>openSource(n),'photo');
    const im=document.createElement('img');im.src=s.preview;im.alt='';im.loading='lazy';
    b.append(im,elem('strong','Фото '+n),elem('span',s.title)); gallery.append(b);
  });
  byId('albumTab').textContent = 'Фотографії · '+(gallery.childElementCount + familyPhotos.count);
  byId('treeTab').onclick=()=>switchTab('tree');
  byId('mapTab').onclick=()=>switchTab('map');
  byId('albumTab').onclick=()=>switchTab('album');
  byId('closeDialog').onclick=()=>byId('sourceDialog').close();
  byId('sourceDialog').onclick=e=>{if(e.target===byId('sourceDialog'))e.target.close();};
  byId('sourceDialog').addEventListener('close', e => {
    if (!e.currentTarget.open) {
      stopSourceVideo();
      syncPersonPanel();
    }
  });
  byId('search').oninput=find;
  byId('search').onkeydown=e=>{
    if(e.key==='Escape')byId('results').hidden=true;
    if(e.key==='Enter'&&!byId('results').hidden)byId('results').querySelector('button')?.click();
  };
  document.addEventListener('pointerdown',e=>{if(!e.target.closest('.find'))byId('results').hidden=true;});
  for (const control of document.querySelectorAll('[data-scope]')) {
    control.onclick = () => {
      const preset = mode === 'family' ? returnView?.baseGeneration : displayedGeneration();
      if (mode === 'family' && returnView) kind = returnView.kind;
      returnView = null;
      setView(control.dataset.scope,rootKey,preset || 'all');
    };
  }
  for (const control of document.querySelectorAll('[data-kind]')) control.onclick = () => {
    const next = control.dataset.kind;
    if (kind === next) return;
    const preset = displayedGeneration();
    kind = next;
    setView(scope(),rootKey,preset || 'all');
  };
  byId('generationDepth').onchange = event => {
    const preset = event.target.value;
    if (preset === 'custom') return;
    setGeneration(preset);
    byId('results').hidden = true;
    if (selected && !visible.has(selected)) closeSide();
    const anchor = cardAnchor(selected || rootKey);
    const inView = anchor && anchor.x >= 0 && anchor.x <= board.clientWidth && anchor.y >= 0 && anchor.y <= board.clientHeight;
    drawGraph(inView && zoom >= .7 ? {anchor} : {reset:true});
    if (selected) showPerson(selected);
  };
  byId('minus').onclick=()=>{clearWheel(); magnify(1/1.24);};
  byId('plus').onclick=()=>{clearWheel(); magnify(1.24);};
  byId('fit').onclick=()=>{clearWheel(); fit();};
  byId('home').onclick=()=>{
    clearWheel();
    if (mode === 'family' && !sceneNodes.has(rootKey)) byId('returnView').click();
    closeSide(); center(rootKey);
  };
  let drag = null;
  board.onpointerdown=e=>{
    if(e.pointerType!=='mouse'||e.button||e.target.closest('button'))return;
    drag=[e.clientX,e.clientY,board.scrollLeft,board.scrollTop];board.setPointerCapture(e.pointerId);board.classList.add('moving');
  };
  board.onpointermove=e=>{if(drag)board.scrollTo(drag[2]+drag[0]-e.clientX,drag[3]+drag[1]-e.clientY);};
  board.onpointerup=board.onpointercancel=()=>{drag=null;board.classList.remove('moving');};

  function applyWheelZoom(now) {
    wheelFrame = 0;
    const requested = pendingZoomLog;
    pendingZoomLog = 0;
    if (!requested) return;
    const direction = Math.sign(requested);
    if (direction !== lastWheelDirection) wheelAllowance = .075;
    wheelAllowance = Math.min(.075, wheelAllowance + (now - lastWheelFrame) * .0009);
    lastWheelFrame = now;
    lastWheelDirection = direction;
    const change = direction * Math.min(Math.abs(requested), wheelAllowance);
    wheelAllowance -= Math.abs(change);
    if (change) {
      const rect = board.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const x = Number.isFinite(pointerX) ? (pointerX - rect.left) * board.offsetWidth/rect.width - board.clientLeft : board.clientWidth / 2;
      const y = Number.isFinite(pointerY) ? (pointerY - rect.top) * board.offsetHeight/rect.height - board.clientTop : board.clientHeight / 2;
      magnify(Math.exp(change), x, y);
    }
  }
  function queueZoom(logChange, clientX, clientY) {
    if (!Number.isFinite(logChange) || !logChange) return;
    pendingZoomLog += logChange;
    pointerX = clientX; pointerY = clientY;
    if (!wheelFrame) wheelFrame = requestAnimationFrame(applyWheelZoom);
  }
  board.addEventListener('wheel', e=>{
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    if (pinch) return;
    const units=e.deltaMode;
    const pixels = e.deltaY * (units===WheelEvent.DOM_DELTA_LINE ? 16 : units===WheelEvent.DOM_DELTA_PAGE ? board.clientHeight : 1);
    queueZoom(-pixels * .0025, e.clientX, e.clientY);
  },{passive:false});

  function beginPinch(source, value, clientX, clientY) {
    clearWheel();
    pinch = {source, value, clientX, clientY};
  }
  function updatePinch(value, clientX, clientY) {
    if (!(value > 0) || !Number.isFinite(value)) return;
    if (Number.isFinite(clientX) && Number.isFinite(clientY) && (clientX || clientY)) {
      pinch.clientX = clientX; pinch.clientY = clientY;
    }
    queueZoom(Math.log(value / pinch.value), pinch.clientX, pinch.clientY);
    pinch.value = value;
  }
  function releasePinch() {
    if (pinch?.source === 'touch') board.removeEventListener('touchmove', onTouchZoom);
    pinch = null;
  }
  function touchDistance(a,b) { return Math.hypot(a.clientX-b.clientX, a.clientY-b.clientY); }
  function onTouchZoom(e) {
    if (pinch?.source !== 'touch' || e.touches.length !== 2) return;
    if (e.cancelable) e.preventDefault();
    const [a,b] = e.touches;
    updatePinch(touchDistance(a,b), (a.clientX+b.clientX)/2, (a.clientY+b.clientY)/2);
  }

  // WebKit sends a cumulative scale for a trackpad pinch; consume only its increments.
  board.addEventListener('gesturestart', e => {
    e.preventDefault();
    if (pinch?.source === 'touch') return;
    beginPinch('gesture', e.scale > 0 ? e.scale : 1, e.clientX || undefined, e.clientY || undefined);
  }, {passive:false});
  window.addEventListener('gesturechange', e => {
    if (!pinch) return;
    e.preventDefault();
    if (pinch.source === 'gesture') updatePinch(e.scale, e.clientX, e.clientY);
  }, {passive:false});
  window.addEventListener('gestureend', e => {
    if (!pinch) return;
    e.preventDefault();
    if (pinch.source === 'gesture') releasePinch();
  }, {passive:false});
  window.addEventListener('blur', clearWheel);

  if (navigator.maxTouchPoints) {
    board.addEventListener('touchstart', e => {
      const [a,b] = e.touches;
      if (e.touches.length !== 2 || !board.contains(a.target) || !board.contains(b.target)) {
        if (pinch?.source === 'touch') clearWheel();
        return;
      }
      const distance = touchDistance(a,b);
      if (distance > 0 && e.cancelable) {
        e.preventDefault();
        beginPinch('touch', distance);
        board.addEventListener('touchmove', onTouchZoom, {passive:false});
      }
    }, {passive:false});
    const endTouch = () => { if (pinch?.source === 'touch') releasePinch(); };
    board.addEventListener('touchend', endTouch);
    board.addEventListener('touchcancel', endTouch);
  }
  new ResizeObserver(() => {
    if (!board.clientWidth || byId('treeView').hidden) return;
    if (compactClose !== needsCompactClose()) drawGraph({reset:true});
    else rescale();
  }).observe(board);
  const target = window.FamilyLinks.read(location.hash);
  sourceMode = target.sources || 'all';
  const sourceCount = elem('output', undefined, 'source-count');
  sourceCount.id = 'sourceCount';
  sourceCount.setAttribute('aria-live','polite');
  byId('sourceToolbar').append(createSourceSwitch(),sourceCount);
  const family = data.people.find(person => person.id === target.family);
  const person = data.people.find(person => person.id === target.person);
  if (family) {
    setView('family',family.key);
  } else {
    setGeneration('all');
    drawGraph();
    center(rootKey);
  }
  if (new URLSearchParams(location.hash.slice(1)).get('view') === 'map') {
    switchTab('map', person && mappedPersonIds.has(person.id) ? {personId:person.id} : undefined);
  } else if (person) showPerson(person.key, !family || sceneNodes.has(person.key));
  if (location.protocol === 'file:') window.addEventListener('hashchange', () => location.reload());
})();
