/* Geometry for the direct pedigree and a person's immediate family.
   Coordinates are in unscaled canvas pixels. */
(function () {
  'use strict';

  const cardWidth = 218;
  const cardHeight = 118;
  const columnGap = 28;
  const wingGap = 128;
  const pitch = cardWidth + columnGap;
  const rowGap = 86;
  const gutter = 152;
  const padding = 18;

  const generationNames = new Map([
    [-5, 'Покоління прапрапрадідів'],
    [-4, 'Покоління прапрадідів'],
    [-3, 'Покоління прадідів'],
    [-2, 'Покоління дідусів і бабусь'],
    [-1, 'Покоління батьків'],
    [0, 'Покоління основної особи'],
    [1, 'На покоління молодші']
  ]);

  function generationName(level) {
    return generationNames.get(level) ||
      ('Покоління ' + (level > 0 ? '+' : '') + level + ' від основної особи');
  }

  function role(edge, focus) {
    const isOlder = edge.b === focus;
    const identified = isOlder ? edge.roleA : edge.roleB;
    if (identified) return identified;
    switch (edge.type) {
      case 'parent': return isOlder ? 'Мати / батько' : 'Дитина';
      case 'stepparent': return isOlder ? 'Вітчим / мачуха' : 'Пасинок / падчерка';
      case 'spouse': return 'Чоловік / дружина';
      case 'sibling': return 'Брат / сестра';
      default: return 'Інший родинний зв’язок';
    }
  }

  function branchOf(person) {
    return person.branch === 'self' ? '' : person.branch;
  }

  function node(person, x, y, caption, height, level = person.level) {
    return {key: person.key, x, y, w: cardWidth, h: height, caption, level};
  }

  const rowHeight = (keys, naturalHeights) =>
    Math.max(cardHeight, ...keys.map(key => naturalHeights?.get(key) || 0));

  function branchOrder(person) {
    return {m: 0, f: 1}[person.branch] ?? 2;
  }

  function buildPedigree(people, edges, focus, compact, naturalHeights) {
    const root = people.get(focus);
    const parentLinks = key => edges.filter(e => e.type === 'parent' && e.b === key);
    const parentalEdges = parentLinks(focus);
    const parents = [...new Set(parentalEdges.map(e => e.a))]
      .map(key => people.get(key))
      .sort((a, b) => branchOrder(a) - branchOrder(b));
    const links = [...parentalEdges];
    const slots = [];
    const groups = [];
    const rootLevel = root.level ?? 0;
    const labels = [];
    for (const parent of parents) {
      const ancestry = parentLinks(parent.key);
      links.push(...ancestry);
      const keys = [...new Set(ancestry.map(e => e.a))];
      if (!keys.length) {
        // Reserve the parent column even when no earlier generation is known.
        groups.push({parent, center: slots.length});
        slots.push(null);
        continue;
      }
      const indices = keys.map(key => {
        if (!slots.includes(key)) slots.push(key);
        return slots.indexOf(key);
      });
      groups.push({parent, center: (Math.min(...indices) + Math.max(...indices)) / 2});
    }
    const columns = Math.max(slots.length, parents.length, 1);
    const divided = focus === 'root' && ['m','f'].every(branch => parents.some(p=>p.branch === branch));
    const spread = divided ? (wingGap-columnGap)/2 : 0;
    const width = gutter + columns * pitch - columnGap + padding + 2*spread;
    const nodes = [];
    let y = padding;
    function addLabel(level) {
      labels.push({text: generationName(level), x: padding, y: y + 12, level, w: gutter - 2 * padding});
    }
    if (slots.some(Boolean)) {
      const height = rowHeight(slots,naturalHeights);
      addLabel(rootLevel - 2);
      slots.forEach((key, i) => {
        if (!key) return;
        const person = people.get(key);
        const incoming = links.find(e => e.a === key && parents.some(parent => parent.key === e.b));
        const side = person.branch === 'm' ? 'з боку мами' : person.branch === 'f' ? 'з боку тата' : '';
        const title = incoming?.roleA === 'Мама' ? 'Бабуся' : incoming?.roleA === 'Тато' ? 'Дідусь' : '';
        const caption = [title, side].filter(Boolean).join(' ') || 'Старше покоління';
        nodes.push(node(person, gutter + i * pitch, y, caption,height));
      });
      y += height + rowGap;
    }
    if (parents.length) {
      const height = rowHeight(parents.map(p=>p.key),naturalHeights);
      addLabel(rootLevel - 1);
      groups.forEach(({parent, center}, i) => {
        const link = parentalEdges.find(e => e.a === parent.key);
        const roleName = link?.roleA || 'Мати / батько';
        const caption = focus === 'root' ? roleName + ' основної особи' : roleName;
        const slot = groups.some((g, j) => j !== i && Math.abs(g.center - center) < 1)
          ? (columns - parents.length) / 2 + i : center;
        nodes.push(node(parent, gutter + slot * pitch, y, caption,height));
      });
      y += height + rowGap;
    }
    addLabel(rootLevel);
    const rootHeight = rowHeight([focus],naturalHeights);
    nodes.push(node(root, gutter + (columns - 1) * pitch / 2, y, 'Вихідна особа',rootHeight));
    for (const n of nodes) {
      const wing = people.get(n.key).branch;
      n.x += wing === 'f' ? 2*spread : wing === 'self' ? spread : 0;
    }
    const positions = new Map(nodes.map(n => [n.key, n]));
    const dividerX = divided ? positions.get(focus).x + cardWidth/2 : null;
    if (compact && divided) {
      for (const p of parents) {
        const parent = positions.get(p.key);
        parent.w = 174;
        parent.x = p.branch === 'm' ? dividerX-18-parent.w : dividerX+18;
      }
    }
    const coupled = new Map();
    for (const {parent} of groups) {
      const ancestry = links.filter(e=>e.b === parent.key);
      if (ancestry.length !== 2 || ancestry.some(e=>e.uncertain)) continue;
      const pair = ancestry.map(e=>positions.get(e.a)).sort((a,b)=>a.x-b.x);
      if (pair[1].x-pair[0].x > pitch+5) continue;
      coupled.set(parent.key,pair);
    }
    const lines = links.map(edge => {
      const from = positions.get(edge.a), to = positions.get(edge.b);
      const x = from.x + from.w/2, target = to.x + to.w/2;
      const bottom = from.y + from.h, joint = (bottom + to.y) / 2;
      if (coupled.has(edge.b)) {
        const [left,right] = coupled.get(edge.b), center = (left.x+cardWidth+right.x)/2;
        const sideX = from.key === left.key ? left.x+cardWidth : right.x;
        const pairY = from.y+from.h*.72;
        return {...edge, branch:branchOf(people.get(edge.a)), path:'M'+sideX+' '+pairY+
          ' H'+center+' V'+joint+' H'+target+' V'+to.y};
      }
      if (divided && edge.b === focus) {
        const entry = target + Math.sign(x-target)*32;
        return {...edge, branch:branchOf(people.get(edge.a)), path:'M'+x+' '+bottom+' V'+(bottom+10)+
          ' L'+entry+' '+(to.y-12)+' V'+to.y};
      }
      return {...edge, branch: branchOf(people.get(edge.a)), path: 'M' + x + ' ' + bottom +
        ' V' + joint + ' H' + target + ' V' + to.y};
    });
    return {width, height: y + rootHeight + padding, nodes, edges: lines, labels, dividerX};
  }

  function buildFamily(people, edges, focus, naturalHeights) {
    const subject = people.get(focus);
    const incident = edges.filter(e => e.a === focus || e.b === focus);
    const neighbors = new Map();
    for (const e of incident) {
      const key = e.a === focus ? e.b : e.a;
      if (!neighbors.has(key)) neighbors.set(key, []);
      neighbors.get(key).push(e);
    }
    const rootLevel = subject.level ?? 0;
    const rows = new Map([[rootLevel, [focus]]]);
    const style = e => e.type + (e.uncertain ? '-uncertain' : '');
    for (const [key, links] of neighbors) {
      const parent = links.find(e => e.type === 'parent' || e.type === 'stepparent');
      const level = people.get(key).level ?? rootLevel + (parent ? (parent.b === focus ? -1 : 1) : 0);
      if (!rows.has(level)) rows.set(level, []);
      rows.get(level).push(key);
    }
    // Keep the same type of relationship together; each type gets its own local bus.
    for (const keys of rows.values()) {
      keys.sort((a, b) => {
        if (a === focus || b === focus) return a === focus ? -1 : 1;
        const diff = style(neighbors.get(a)[0]).localeCompare(style(neighbors.get(b)[0]));
        return diff || branchOrder(people.get(a)) - branchOrder(people.get(b));
      });
    }
    const peers = rows.get(rootLevel).filter(k => k !== focus);
    const left = peers.slice(0, Math.ceil(peers.length / 2)).reverse();
    const right = peers.slice(left.length);
    rows.set(rootLevel, [...left, focus, ...right]);
    const levels = [...rows.keys()].sort((a, b) => a - b);
    const halfSpan = Math.max(left.length, right.length, ...[...rows.values()].map(row => (row.length - 1) / 2));
    const focusX = gutter + halfSpan * pitch;
    const divided = focus === 'root' && ['m','f'].every(branch=>[...neighbors.keys()].some(k=>people.get(k).branch === branch));
    const spread = divided ? (wingGap-columnGap)/2 : 0;
    const width = focusX + halfSpan * pitch + cardWidth + padding + (levels.length > 3 ? 24 : 0) + 2*spread;
    const positions = new Map();
    const labels = [];
    const peerLanes = new Map();
    let y = padding;
    for (const level of levels) {
      const keys = rows.get(level);
      const height = rowHeight(keys,naturalHeights);
      if (level === rootLevel && peers.length) y += 22;
      labels.push({text:generationName(level),x:padding,y:y+12,level,w:gutter - 2 * padding});
      const offset = level === rootLevel ? left.length : (keys.length - 1) / 2;
      keys.forEach((key, i) => {
        const links = neighbors.get(key) || [];
        const caption = key === focus ? 'Вибрана людина'
          : [...new Set(links.map(e => role(e, focus) + (e.uncertain ? ' · імовірно' : '')))].join(' / ');
        const p = people.get(key), extra = p.branch === 'f' ? 2*spread : p.branch === 'self' ? spread : 0;
        positions.set(key, node(p, focusX + (i-offset)*pitch + extra, y, caption, height, level));
      });
      y += height + rowGap;
    }
    // Peers join the sides of the selected card. Older and younger generations
    // reach its top and bottom, leaving each part of the drawing independent.
    for (const peersOnSide of [left.slice().reverse(), right]) {
      const styles = [];
      for (const key of peersOnSide) {
        for (const e of neighbors.get(key)) {
          if (!styles.includes(style(e))) styles.push(style(e));
          peerLanes.set(e, styles.indexOf(style(e)));
        }
      }
    }
    const hub = positions.get(focus);
    const verticalStyles = new Map();
    for (const level of levels) {
      if (level === rootLevel) continue;
      verticalStyles.set(level, [...new Set(rows.get(level).flatMap(key => neighbors.get(key).map(style)))]);
    }
    const lines = incident.map(edge => {
      const key = edge.a === focus ? edge.b : edge.a;
      const peer = positions.get(key);
      const branch = branchOf(people.get(key)) || branchOf(subject);
      const peerX = peer.x + cardWidth / 2;
      let path;
      if (peer.level === rootLevel) {
        const lane = peerLanes.get(edge);
        const side = peer.x < hub.x ? -1 : 1;
        const hubSide = side === -1 ? hub.x : hub.x + cardWidth;
        const elbow = hubSide + side * (8 + Math.min(lane, 3) * 4);
        const top = peer.y - 10 - lane * 8;
        const endY = hub.y + hub.h / 2 + lane * 6;
        path = 'M' + peerX + ' ' + peer.y + ' V' + top + ' H' + elbow + ' V' + endY + ' H' + hubSide;
      } else {
        const older = peer.level < rootLevel;
        const styles = verticalStyles.get(peer.level);
        const lane = styles.indexOf(style(edge)) - (styles.length - 1) / 2;
        const targetX = hub.x + cardWidth / 2 + lane*20;
        const peerEdge = older ? peer.y + peer.h : peer.y;
        const hubEdge = older ? hub.y : hub.y + hub.h;
        if (Math.abs(levels.indexOf(rootLevel)-levels.indexOf(peer.level)) === 1) {
          const joint = (peerEdge + hubEdge)/2 + lane*12;
          path = 'M' + peerX + ' ' + peerEdge + ' V' + joint + ' H' + targetX + ' V' + hubEdge;
        } else {
          // A non-parent relation can span several actual generations.
          // Carry that line in the outside margin, clear of intermediate cards.
          const direction = older ? 1 : -1, outside = width - padding/2;
          path = 'M' + peerX + ' ' + peerEdge + ' v' + direction*20 + ' H' + outside +
            ' V' + (hubEdge-direction*32) + ' H' + targetX + ' V' + hubEdge;
        }
      }
      return {...edge, branch, path};
    });
    const dividerX = divided ? hub.x+cardWidth/2 : null;
    return {width, height: y - rowGap + padding, nodes: [...positions.values()], edges: lines, labels, dividerX};
  }

  window.KinLayout = {
    build(data, options = {}) {
      const people = new Map(data.people.map(p => [p.key, p]));
      const focus = options.focus ?? 'root';
      if (!people.has(focus)) return {width: 0, height: 0, nodes: [], edges: [], labels: []};
      const edges = data.edges.filter(e => people.has(e.a) && people.has(e.b) && e.a !== e.b);
      return options.mode === 'family' ? buildFamily(people, edges, focus, options.naturalHeights)
        : buildPedigree(people, edges, focus, options.compact, options.naturalHeights);
    }
  };
})();
