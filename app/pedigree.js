/* Offline, layered family chart. The graph is authoritative; layout never creates a relationship. */
window.Pedigree = (() => {
  'use strict';

  const cardW = 248, cardH = 106, pitch = cardW + 30, margin = 26, gutter = 150;
  const wingGap = 128, familyGap = 60;
  const title = new Map([
    [-5, 'Прапрапрадіди й прапрапрабабусі'], [-4, 'Прапрадіди й прапрабабусі'],
    [-3, 'Прадіди й прабабусі'], [-2, 'Дідусі й бабусі'], [-1, 'Покоління батьків'],
    [0, 'Покоління основної особи'], [1, 'Молодше покоління']
  ]);
  const average = values => values.reduce((sum, x) => sum + x, 0) / values.length;
  const round = x => Math.round(x * 10) / 10;
  const add = (map, key, value) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(value);
  };

  // Minimum-distance positions subject to a card-width gap, preserving the row order.
  function pack(row, target, spacing, min = -Infinity, max = Infinity) {
    const pools = [], offsets = [0];
    for (let i = 1; i < row.length; i++) offsets.push(offsets[i-1] + spacing(row[i-1],row[i]));
    row.forEach((key, i) => {
      const {x, weight} = target(key);
      pools.push({start:i, end:i, mass:weight, sum:(x - offsets[i]) * weight});
      while (pools.length > 1) {
        const right = pools.at(-1), left = pools.at(-2);
        if (left.sum / left.mass <= right.sum / right.mass) break;
        left.end = right.end;
        left.sum += right.sum;
        left.mass += right.mass;
        pools.pop();
      }
    });
    const positions = new Map();
    for (const pool of pools) {
      const origin = Math.max(min, Math.min(max - offsets.at(-1), pool.sum / pool.mass));
      for (let i = pool.start; i <= pool.end; i++) positions.set(row[i], origin + offsets[i]);
    }
    return positions;
  }

  function indexFamilies(data, visible, focus, compact) {
    const all = new Map(data.people.map(p => [p.key, p]));
    const adjacency = new Map(), parent = new Map();
    for (const e of data.edges) {
      if (!all.has(e.a) || !all.has(e.b)) continue;
      add(adjacency, e.a, e.b);
      add(adjacency, e.b, e.a);
      if (e.type === 'parent') add(parent, e.b, e.a);
    }
    const distance = new Map([[focus, 0]]), queue = [focus];
    for (let i = 0; i < queue.length; i++) {
      for (const key of adjacency.get(queue[i]) || []) {
        if (distance.has(key)) continue;
        distance.set(key, distance.get(queue[i]) + 1);
        queue.push(key);
      }
    }
    // Preserve each person's mother's/father's family order as the pedigree fans out.
    const order = new Map(data.people.map((p, index) => [p.key, index]));
    const pedigree = new Map(), anchors = new Map([[focus, 0]]);
    const parents = key => [...new Set(parent.get(key) || [])]
      .sort((a, b) => order.get(a) - order.get(b));
    let generation = [focus];
    while (generation.length) {
      const next = [];
      for (const k of generation) {
        if (pedigree.has(k)) continue;
        pedigree.set(k, pedigree.size);
        next.push(...parents(k));
      }
      generation = next;
    }
    const pp = parents(focus);
    // Removing the focus and parents leaves the families reached through each
    // grandparent. Keep a connected component together if grandparents recur.
    function partition(blocked) {
      const labels = new Map(), sizes = new Map();
      for (const p of data.people) {
        if (blocked.has(p.key) || labels.has(p.key)) continue;
        const members = [p.key];
        labels.set(p.key,p.key);
        for (let i=0; i<members.length; i++) {
          for (const k of adjacency.get(members[i]) || []) {
            if (blocked.has(k) || labels.has(k)) continue;
            labels.set(k,p.key);
            members.push(k);
          }
        }
        sizes.set(p.key,members.length);
      }
      return [labels,sizes];
    }
    const core = new Set([focus,...pp]);
    const [component,size] = partition(core);
    for (const k of pp.flatMap(parents)) core.add(k);
    const [clan,clanSize] = partition(core);
    const people = data.people.filter(p => visible.has(p.key));
    const edges = data.edges.filter(e => visible.has(e.a) && visible.has(e.b));
    // Each wing keeps its direction from Max even when the other wing is filtered out.
    const anchorWings = focus === 'root' && visible.has(focus);
    const divided = anchorWings && ['m','f'].every(side=>people.some(p=>p.branch === side));
    const blockOrder = new Map(), clanOrder = new Map();
    pp.forEach((k, i) => {
      const direction = all.get(k).branch === 'm' ? -1 : 1;
      const gp = parents(k);
      const center = anchorWings ? direction*(cardW/2+wingGap/2+pitch/2) : (i-(pp.length-1)/2)*2*pitch;
      anchors.set(k,compact && divided ? direction*(cardW/2+8) : center);
      // Put the larger extended family outward, with the two grandparents
      // still next to one another at Max's end of their branch.
      gp.sort((a,b)=>direction*(size.get(component.get(a))-size.get(component.get(b))) || order.get(a)-order.get(b));
      gp.forEach((g,j) => {
        const x = center + (j-(gp.length-1)/2)*pitch;
        anchors.set(g,x);
        blockOrder.set(component.get(g),x);
        const clanRank = k => clanSize.get(clan.get(k)) || 0;
        const pair = parents(g).sort((a,b)=>direction*(clanRank(a)-clanRank(b)) || order.get(a)-order.get(b));
        pair.forEach((h,i)=>clanOrder.set(clan.get(h), (i-(pair.length-1)/2)*.5));
      });
    });
    return {people, edges, all, order, anchors, distance, pedigree, divided, anchorWings, compact, component, blockOrder, clan, clanOrder};
  }

  function arrange(family, focus) {
    const {people, edges, all, order, anchors, distance, pedigree, anchorWings, component, blockOrder, clan, clanOrder} = family;
    const focusLevel = all.get(focus)?.level ?? 0;
    const side = key => {
      if (key === focus) return 0;
      if (!anchorWings && anchors.has(key)) return Math.sign(anchors.get(key));
      return all.get(key).branch === 'f' ? 1 : -1;
    };
    const near = key => distance.get(key) ?? 999;
    const fixed = key => anchors.has(key);
    const rows = new Map(), group = new Map(), neighbors = new Map();
    for (const p of people) {
      add(rows, p.level, p.key);
      group.set(p.key, p.key);
    }
    function rep(key) {
      while (group.get(key) !== key) key = group.get(key);
      return key;
    }
    function affinity(a, b, weight) {
      add(neighbors, a, {key:b, weight});
      add(neighbors, b, {key:a, weight});
    }
    function unite(a, b) {
      if (all.get(a).level !== all.get(b).level || side(a) !== side(b) || fixed(a) !== fixed(b)) return;
      // Relatives can form an outer group without pulling a direct ancestor into it.
      if (pedigree.has(a) !== pedigree.has(b)) return;
      if (clan.has(a) && clan.has(b) && clan.get(a) !== clan.get(b)) return;
      group.set(rep(b), rep(a));
    }
    const parentsByChild = new Map(), childrenByParent = new Map();
    for (const e of edges) {
      if (e.type === 'parent') {
        add(parentsByChild, e.b, e.a);
        add(childrenByParent, e.a, e.b);
        affinity(e.a, e.b, 5);
      } else {
        affinity(e.a, e.b, e.type === 'spouse' ? 7 : 2);
        if (['sibling', 'spouse'].includes(e.type)) unite(e.a, e.b);
      }
    }
    for (const relatives of [...parentsByChild.values(), ...childrenByParent.values()]) {
      for (let i = 0; i < relatives.length; i++) for (let j = i + 1; j < relatives.length; j++) {
        unite(relatives[i], relatives[j]);
        affinity(relatives[i], relatives[j], 3);
      }
    }
    const levels = [...rows.keys()].sort((a,b) => a-b), position = new Map(), preferred = new Map();
    function rank(key) {
      return pedigree.has(key) ? pedigree.get(key) : 1000 + near(key) * 1000 + order.get(key);
    }
    function compare(a, b) {
      const sideA = side(a), sideB = side(b);
      if (sideA !== sideB) return sideA - sideB;
      if (fixed(a) && fixed(b)) return anchors.get(a) - anchors.get(b);
      if (fixed(a) !== fixed(b)) return (fixed(a) ? -1 : 1) * sideA;
      if (pedigree.has(a) && pedigree.has(b)) return rank(a) - rank(b);
      return (rank(a) - rank(b)) * sideA;
    }
    for (const row of rows.values()) {
      row.sort(compare);
      const left = row.filter(k => side(k) < 0).length;
      row.forEach((k, i) => {
        const initial = fixed(k) ? anchors.get(k) : (i - left + .5) * pitch;
        position.set(k, initial);
        preferred.set(k, initial);
      });
    }

    function tendency(key, includePeers) {
      let sum = 0, mass = 0;
      for (const n of neighbors.get(key) || []) {
        if (!includePeers && all.get(key).level === all.get(n.key).level) continue;
        sum += n.weight * position.get(n.key);
        mass += n.weight;
      }
      return mass ? sum / mass : position.get(key);
    }
    const familyRank = key => (blockOrder.get(component.get(key)) ?? 0) + (clanOrder.get(clan.get(key)) ?? 0);
    const separation = (a,b) => {
      if (component.has(a) && component.has(b) && component.get(a) !== component.get(b)) return pitch+familyGap;
      if (clan.has(a) && clan.has(b) && clan.get(a) !== clan.get(b)) return pitch+28;
      return rep(a) === rep(b) ? pitch : pitch+12;
    };
    function packRow(row,desired,level) {
      if (!anchorWings) return pack(row,desired,separation);
      const result = new Map();
      const bankGap = family.compact && level === focusLevel-1 ? 8 : wingGap/2;
      const clearance = cardW/2 + (level === focusLevel ? cardW/2+32 : bankGap);
      for (const which of [-1,0,1]) {
        const wing = row.filter(k => side(k) === which);
        if (!wing.length) continue;
        if (which === 0) { result.set(focus,0); continue; }
        const positions = pack(wing,desired,separation,which === 1 ? clearance : -Infinity, which === -1 ? -clearance : Infinity);
        for (const [k,x] of positions) result.set(k,x);
      }
      return result;
    }
    function sweep(level) {
      const row = rows.get(level);
      const byUnit = new Map();
      for (const k of row) add(byUnit, rep(k), k);
      const memberScore = k => fixed(k) ? anchors.get(k) : .7*tendency(k, true) + .3*preferred.get(k);
      const units = [...byUnit.values()].map(keys => {
        keys.sort((a,b) => fixed(a) && fixed(b) ? compare(a,b) : memberScore(a)-memberScore(b) || compare(a,b));
        return {keys, side:side(keys[0]), fixed:fixed(keys[0]),
          distance:Math.min(...keys.map(near)),
          score:average(keys.map(k => fixed(k) ? anchors.get(k) : .8*tendency(k, false) + .2*preferred.get(k)))};
      });
      units.sort((a,b) => {
        if (a.side !== b.side) return a.side - b.side;
        if (a.fixed !== b.fixed) return (a.fixed ? -1 : 1) * a.side;
        const ancestorA = pedigree.has(a.keys[0]), ancestorB = pedigree.has(b.keys[0]);
        if (ancestorA !== ancestorB) return ancestorA ? -a.side : a.side;
        // Near Max, his aunts, uncles and cousins stay inside more distant collateral branches.
        if (level >= focusLevel - 1 && Math.min(a.distance,b.distance) <= 4 && a.distance !== b.distance) {
          return (a.distance - b.distance) * a.side;
        }
        if (!a.fixed && !b.fixed) {
          const block = familyRank(a.keys[0])-familyRank(b.keys[0]);
          if (block) return block;
        }
        return a.score - b.score;
      });
      const ordered = units.flatMap(unit => unit.keys);
      rows.set(level, ordered);
      const packed = packRow(ordered, key => fixed(key)
        ? {x:anchors.get(key),weight:100000}
        : {x:.83*tendency(key, true) + .17*preferred.get(key),weight:1},level);
      for (const [key, x] of packed) position.set(key, x);
    }
    for (let i = 0; i < 10; i++) {
      for (const level of i % 2 ? levels : [...levels].reverse()) sweep(level);
    }
    // Barycentres give short connections, but can invert whole families. Compare actual
    // relationships at adjoining levels before exchanging sibling groups or their members.
    const orderIndex = new Map();
    const update = row => row.forEach((k,i) => orderIndex.set(k,i));
    for (const row of rows.values()) update(row);
    const rowScore = new Map();
    for (const level of levels) {
      const local = edges.filter(e => all.get(e.a).level === level || all.get(e.b).level === level);
      const same = local.filter(e => all.get(e.a).level === all.get(e.b).level);
      const columns = local.filter(e => all.get(e.a).level !== all.get(e.b).level).map(e => {
        const here = all.get(e.a).level === level ? e.a : e.b;
        const there = here === e.a ? e.b : e.a;
        return {here,there, remote:all.get(there).level, w:e.type === 'parent' ? 1 : .65};
      });
      const partners = new Map();
      for (const parents of parentsByChild.values()) {
        const visible = parents.filter(k => all.get(k).level === level);
        for (let i=0; i<visible.length; i++) for (let j=i+1; j<visible.length; j++) {
          partners.set(JSON.stringify([visible[i],visible[j]].sort()), [visible[i],visible[j]]);
        }
      }
      rowScore.set(level, () => {
        let cost = 0;
        for (const [a,b] of partners.values()) {
          cost += 5 * Math.abs(orderIndex.get(a)-orderIndex.get(b));
        }
        for (const e of same) {
          cost += (e.type === 'spouse' ? 1.8 : .55) * Math.abs(orderIndex.get(e.a)-orderIndex.get(e.b));
        }
        for (let i = 0; i < columns.length; i++) {
          const a = columns[i];
          cost += .16*a.w*Math.abs(position.get(a.here)-position.get(a.there))/pitch;
          for (let j = i+1; j < columns.length; j++) {
            const b = columns[j];
            if (a.remote !== b.remote) continue;
            if ((orderIndex.get(a.here)-orderIndex.get(b.here))*(orderIndex.get(a.there)-orderIndex.get(b.there)) < 0) {
              cost += 4*a.w*b.w;
            }
          }
        }
        return cost;
      });
    }
    function refine(level) {
      const row = rows.get(level), slots = row.map(k => position.get(k));
      const units = [];
      for (const key of row) {
        if (!units.length || rep(key) !== rep(units.at(-1)[0])) units.push([]);
        units.at(-1).push(key);
      }
      const apply = () => {
        const ordered = units.flat();
        ordered.forEach((k, i) => {position.set(k, slots[i]); orderIndex.set(k, i);});
        rows.set(level, ordered);
      };
      const score = rowScore.get(level);
      let best = score(), improved = false;
      function exchange(array, i) {
        const swap = () => { [array[i], array[i+1]] = [array[i+1], array[i]]; apply(); };
        swap();
        const next = score();
        if (next < best-.001) { best = next; improved = true; }
        else swap();
      }
      for (let i=0; i<units.length-1; i++) {
        const a=units[i], b=units[i+1];
        if (side(a[0]) !== side(b[0]) || fixed(a[0]) || fixed(b[0]) || familyRank(a[0]) !== familyRank(b[0])) continue;
        if (pedigree.has(a[0]) !== pedigree.has(b[0])) continue;
        if (level >= focusLevel-1 && Math.min(...a.map(near)) !== Math.min(...b.map(near))) continue;
        exchange(units,i);
      }
      for (const unit of units) {
        if (unit.some(fixed)) continue;
        for (let i=0; i<unit.length-1; i++) exchange(unit,i);
      }
      return improved;
    }
    for (let i=0; i<12; i++) {
      let changed = false;
      for (const level of i%2 ? levels : [...levels].reverse()) if (refine(level)) changed = true;
      if (!changed) break;
    }
    // After exchanging families every card still needs the spacing of its new neighbours.
    for (const level of levels) {
      const corrected = packRow(rows.get(level),k=>({x:position.get(k),weight:fixed(k)?100000:1}),level);
      for (const [k,x] of corrected) position.set(k,x);
    }
    return {rows, levels, position};
  }

  // Horizontal buses only share a lane if the complete occupied x intervals are disjoint.
  function allocate(items) {
    const lanes = [];
    const intervals = items.map(group => {
      const ports = [...group.ports.values()];
      return {group, left:Math.min(...ports), right:Math.max(...ports)};
    }).sort((a,b) => a.right-a.left - (b.right-b.left) || a.left-b.left);
    for (const interval of intervals) {
      const depth = interval.group.depth || 1;
      function fits(first) {
        for (let i=first; i<first+depth; i++) {
          if (lanes[i]?.some(other => interval.right+12 >= other.left && other.right+12 >= interval.left)) return false;
        }
        return true;
      }
      let lane = 0;
      while (!fits(lane)) lane++;
      for (let i=lane; i<lane+depth; i++) {
        if (!lanes[i]) lanes[i] = [];
        lanes[i].push(interval);
      }
      interval.group.lane = lane;
    }
    return lanes.length;
  }

  function route(family, geometry, naturalHeights) {
    const {people, edges, all} = family, {rows, levels, position} = geometry;
    const source = new Map(), peer = new Map(), cross = new Map(), short = new Set(), jumps = [];
    const coordinate = key => position.get(key);
    const nodeRow = key => all.get(key).level;
    const groups = new Map();
    const groupFor = (id, kind) => {
      if (!groups.has(id)) groups.set(id, {id, kind, edges:[], keys:new Set(), ports:new Map()});
      return groups.get(id);
    };
    function join(g,e) {
      source.set(e,g);
      g.edges.push(e);
      g.keys.add(e.a);
      g.keys.add(e.b);
    }
    // Children can share a bus only when their complete visible parental connections match,
    // including each parent’s evidence status. Step- and unknown relationships get separate paths.
    const origins = new Map();
    for (const e of edges) if (e.type === 'parent') add(origins, e.b, e);
    for (const e of edges) {
      const la = nodeRow(e.a), lb = nodeRow(e.b);
      if (la === lb) {
        const row = rows.get(la);
        if ((e.type === 'spouse' || e.type === 'sibling') && Math.abs(row.indexOf(e.a)-row.indexOf(e.b)) === 1) {
          short.add(e);
        } else {
          const id = e.type === 'sibling' ? JSON.stringify(['siblings',e.a,e.uncertain]) : e.id;
          join(groupFor(id,'peer'), e);
        }
      } else if (Math.abs(levels.indexOf(la)-levels.indexOf(lb)) === 1) {
        const signature = e.type === 'parent' ? JSON.stringify((origins.get(e.b) || [])
          .map(p => [p.a,!!p.uncertain]).sort((a,b) => a[0].localeCompare(b[0]))) : e.id;
        // Distinct confidence and branch styles retain their own visible arms.
        const id = JSON.stringify([la,lb,e.type,signature,!!e.uncertain]);
        join(groupFor(id,'cross'), e);
      } else jumps.push(e);
    }
    const ports = new Map();
    for (const g of groups.values()) {
      const levelsOfGroup = [...g.keys].map(nodeRow);
      g.top = Math.min(...levelsOfGroup); g.bottom = Math.max(...levelsOfGroup);
      add(g.kind === 'peer' ? peer : cross, g.top, g);
      for (const key of g.keys) {
        const bottom = g.kind !== 'peer' && nodeRow(key) === g.top;
        const peers = [...g.keys].filter(k => k !== key);
        add(ports, key + (bottom ? '/bottom':'/top'), {g,key,aim:average(peers.map(coordinate))});
      }
    }
    for (const list of ports.values()) {
      list.sort((a,b) => a.aim-b.aim || String(a.g.id).localeCompare(String(b.g.id)));
      const gap = Math.min(24, (cardW-42) / list.length);
      list.forEach((port,i) => port.g.ports.set(port.key,
        round(coordinate(port.key) + (i - (list.length-1)/2) * gap)));
    }
    // A child directly underneath someone else's parent can have the very same x.
    // Give unrelated vertical stems distinct ports so they cannot look like a shared descent.
    for (const gap of cross.values()) {
      const reserved = [];
      function reserve(g,original) {
        let x = original;
        for (let d=0; reserved.some(p => p.g !== g && Math.abs(p.x-x) < 4); d++) {
          const direction = d%2 === 0 ? 1 : -1;
          x = original + direction * (Math.floor(d/2)+1)*5;
        }
        reserved.push({g,x});
        return x;
      }
      const paired = new Set();
      for (const g of gap) {
        for (const [key,x] of g.ports) g.ports.set(key,reserve(g,x));
        const upper = [...g.keys].filter(k => nodeRow(k) === g.top);
        if (g.edges[0].type !== 'parent' || upper.length < 2) continue;
        // Join co-parents first. Their children hang together from one descent line.
        const lower = [...g.keys].filter(k => nodeRow(k) === g.bottom);
        const midpoint = average(upper.map(k => g.ports.get(k)));
        // For adjacent co-parents, use the short space between the cards as
        // the family junction. A single trunk can then serve all their children.
        const couple = [...upper].sort((a,b)=>coordinate(a)-coordinate(b));
        const pairId = JSON.stringify(couple);
        if (couple.length === 2 && !paired.has(pairId) && !g.edges.some(e=>e.uncertain) &&
            !lower.includes('root') && coordinate(couple[1])-coordinate(couple[0]) <= pitch+familyGap+8 &&
            rows.get(g.top).indexOf(couple[1])-rows.get(g.top).indexOf(couple[0]) === 1) {
          g.couple = couple;
          g.stem = reserve(g,round(average(couple.map(coordinate))));
          paired.add(pairId);
          continue;
        }
        if (lower.length === 1 && Math.abs(g.ports.get(lower[0])-midpoint) < 8) continue;
        g.stem = reserve(g,round(midpoint));
        g.depth = 2;
      }
    }
    const laneGap = 19, gapPad = 25;
    const rowY = new Map();
    const rowHeight = new Map();
    let y = margin;
    for (const level of levels) {
      const height = Math.max(cardH, ...rows.get(level).map(key => naturalHeights?.get(key) || 0));
      rowHeight.set(level,height);
      const same = peer.get(level) || [];
      const peerLanes = allocate(same);
      y += peerLanes ? gapPad+peerLanes*laneGap : 0;
      rowY.set(level,y);
      for (const g of same) g.y = y-gapPad-g.lane*laneGap;
      const down = cross.get(level) || [];
      const crossLanes = allocate(down);
      for (const g of down) g.y = y+height+gapPad+g.lane*laneGap;
      y += height + 2*gapPad + Math.max(1,crossLanes)*laneGap;
    }
    const minX = Math.min(...position.values()) - cardW/2;
    const leftJumps = jumps.filter(e=>family.divided && all.get(e.a).branch === 'm');
    const rightJumps = jumps.filter(e=>!leftJumps.includes(e));
    const offset = margin+gutter-minX+(leftJumps.length ? 20+leftJumps.length*12 : 0);
    const adjusted = x => round(x+offset);
    const nodeX = k => adjusted(coordinate(k));
    const path = points => points.map(([x,y],i) => (i === 0 ? 'M' : 'L') + round(x)+' '+round(y)).join(' ');
    const far = Math.max(...position.values()) + cardW/2;
    const routed = edges.map(e => {
      const la = nodeRow(e.a), lb = nodeRow(e.b), ya = rowY.get(la), yb = rowY.get(lb);
      const ha = rowHeight.get(la), hb = rowHeight.get(lb);
      let points;
      if (family.divided && e.type === 'parent' && e.b === 'root') {
        // Each side ends at its own port on Max. The two coloured stems remain
        // distinguishable all the way from the parents, even at a small scale.
        const xa = nodeX(e.a), xb = nodeX(e.b)+Math.sign(coordinate(e.a))*32;
        points = [[xa,ya+ha],[xa,ya+ha+10],[xb,yb-12],[xb,yb]];
      } else if (short.has(e)) {
        const dir = Math.sign(coordinate(e.b)-coordinate(e.a)), h = e.type === 'spouse' ? .54 : .4;
        points = [[nodeX(e.a)+dir*cardW/2,ya+ha*h],[nodeX(e.b)-dir*cardW/2,yb+hb*h]];
      } else if (source.get(e)?.couple) {
        const g = source.get(e), center = adjusted(g.stem), xb = adjusted(g.ports.get(e.b));
        const sideX = nodeX(e.a) + (g.couple[0] === e.a ? 1 : -1)*cardW/2;
        const pairY = ya + ha*.72;
        points = [[sideX,pairY],[center,pairY],[center,g.y],[xb,g.y],[xb,yb]];
      } else if (source.has(e)) {
        const g = source.get(e), xa = adjusted(g.ports.get(e.a)), xb = adjusted(g.ports.get(e.b));
        points = [[xa,ya+(la < lb ? ha : 0)],[xa,g.y]];
        if (g.depth === 2) {
          const junction = adjusted(g.stem);
          points.push([junction,g.y], [junction,g.y+laneGap]);
        }
        points.push([xb,g.y+(g.depth === 2 ? laneGap : 0)], [xb,yb+(lb < la ? hb : 0)]);
      } else {
        const index = leftJumps.indexOf(e);
        const rail = index < 0 ? adjusted(far+20+rightJumps.indexOf(e)*12) : adjusted(minX-20-index*12);
        const yaPort = ya + (la<lb ? ha : 0);
        const ybPort = yb + (lb<la ? hb : 0);
        const outA = yaPort+(la<lb?9:-9), outB = ybPort+(lb<la?9:-9);
        points = [[nodeX(e.a),yaPort],[nodeX(e.a),outA],[rail,outA],[rail,outB],[nodeX(e.b),outB],[nodeX(e.b),ybPort]];
      }
      return {e, points, bus:source.get(e) || e};
    });
    // A small break at a crossing has its usual diagram meaning: both lines continue,
    // but the crossing itself is not a junction. Matching family buses stay joined.
    const vertical = [];
    for (const {points,bus} of routed) for (let i=1; i<points.length; i++) {
      const [x1,y1] = points[i-1], [x2,y2] = points[i];
      if (x1 === x2 && y1 !== y2) vertical.push({x:x1, min:Math.min(y1,y2), max:Math.max(y1,y2), bus});
    }
    const output = routed.map(({e, points, bus}) => {
      const parts = [[points[0]]];
      for (let i=1; i<points.length; i++) {
        const [x1,y1] = points[i-1], [x2,y2] = points[i];
        if (y1 === y2 && x1 !== x2) {
          const dir = Math.sign(x2-x1);
          const cuts = [...new Set(vertical.filter(v => v.bus !== bus && v.min < y1 && v.max > y1 &&
            v.x > Math.min(x1,x2)+4 && v.x < Math.max(x1,x2)-4).map(v => v.x))]
            .sort((a,b) => dir*(a-b));
          const windows = [];
          for (const x of cuts) {
            const first = x-dir*3.5, last = x+dir*3.5;
            const previous = windows.at(-1);
            if (previous && dir*(first-previous[1]) <= 1) previous[1] = last;
            else windows.push([first,last]);
          }
          for (const [from,to] of windows) {
            parts.at(-1).push([from,y1]);
            parts.push([[to,y1]]);
          }
        }
        parts.at(-1).push(points[i]);
      }
      return {...e, path:parts.map(path).join(' '),
        branch:all.get(e.a).branch === 'self' ? all.get(e.b).branch : all.get(e.a).branch};
    });
    return {
      dividerX:family.divided ? adjusted(0) : null,
      width:Math.ceil(adjusted(far) + margin + (rightJumps.length ? 20+rightJumps.length*12 : 0)),
      height:Math.ceil(rowY.get(levels.at(-1))+rowHeight.get(levels.at(-1))+margin),
      nodes:people.map(p => ({key:p.key,x:round(nodeX(p.key)-cardW/2),y:rowY.get(p.level),w:cardW,h:rowHeight.get(p.level),level:p.level})),
      edges:output,
      labels:levels.map(level => ({level, text:title.get(level) || 'Покоління '+level,
        x:margin,y:rowY.get(level)-23,w:gutter-16}))
    };
  }

  function layout(data, options = {}) {
    const keys = options.keys || new Set(data.people.map(p => p.key));
    const family = indexFamilies(data, keys, options.focus || 'root', options.compact);
    if (!family.people.length) return {width:1,height:1,nodes:[],edges:[],labels:[]};
    return route(family, arrange(family, options.focus || 'root'), options.naturalHeights);
  }
  return {layout, cardWidth: cardW};
})();
