/* Genealogy navigation uses the recorded edges. Inferred kinship is kept separate. */
(() => {
  'use strict';

  function create(data, root = 'root', {focused = false} = {}) {
    const people = new Map(data.people.map(person => [person.key, person]));
    const adjacency = new Map(data.people.map(person => [person.key, []]));
    const isUncertain = edge => Boolean(edge.uncertain || edge.status === 'unresolved');
    for (const edge of data.edges) {
      if (!people.has(edge.a) || !people.has(edge.b) || edge.a === edge.b) continue;
      adjacency.get(edge.a).push({ key: edge.b, edge });
      adjacency.get(edge.b).push({ key: edge.a, edge });
    }
    const links = key => adjacency.get(key) || [];
    const parents = key => links(key).filter(({ edge }) => edge.type === 'parent' && edge.b === key);
    const children = key => links(key).filter(({ edge }) => edge.type === 'parent' && edge.a === key);
    const inScope = (key, scope) => key === root || scope === 'all' || people.get(key)?.branch === scope;
    function neighbors(key, scope, kind) {
      const candidates = kind === 'ancestors' ? parents(key) : links(key);
      return candidates.filter(link => {
        if (!inScope(link.key, scope)) return false;
        if (kind !== 'closeKin' && kind !== 'siblings') return true;
        if (link.edge.type !== 'parent' && link.edge.type !== 'sibling') return false;
        return kind === 'siblings' ? siblingFamily.has(link.key) : isCloseKin(link.key);
      });
    }

    // Distance is counted in recorded relationships; a doubtful edge is still inspectable.
    const routes = new Map();
    function walk(scope, kind) {
      const cacheKey = scope + '/' + kind;
      if (routes.has(cacheKey)) return routes.get(cacheKey);
      const result = new Map();
      const queue = [];
      if (people.has(root)) {
        result.set(root, { depth: 0, previous: null, edge: null, doubts: 0 });
        queue.push(root);
      }
      for (let i = 0; i < queue.length; i++) {
        const key = queue[i];
        const current = result.get(key);
        for (const { key: next, edge } of neighbors(key, scope, kind)) {
          const depth = current.depth + 1;
          const doubts = current.doubts + Number(isUncertain(edge));
          const old = result.get(next);
          if (old && (old.depth < depth || old.doubts <= doubts)) continue;
          if (!old) queue.push(next);
          result.set(next, { depth, previous: key, edge, doubts });
        }
      }
      routes.set(cacheKey, result);
      return result;
    }

    function eligible(scope = 'all', kind = 'everyone') {
      return new Set(walk(scope, kind).keys());
    }
    function initial(scope = 'all', kind = 'everyone', depth = 2) {
      const result = new Set();
      for (const [key, route] of walk(scope, kind === 'siblings' ? kind : 'ancestors')) {
        if (route.depth <= Math.max(0, depth)) result.add(key);
      }
      return result;
    }
    function hiddenNeighbors(visible, key, scope = 'all', kind = 'everyone') {
      if (!visible.has(key) || !walk(scope, kind).has(key)) return [];
      return [...new Set(neighbors(key, scope, kind).map(link => link.key))].filter(next => !visible.has(next));
    }
    function expand(visible, key, scope = 'all', kind = 'everyone') {
      return new Set([...visible, ...hiddenNeighbors(visible, key, scope, kind)]);
    }
    function pathTo(target, scope = 'all', kind = 'everyone') {
      const paths = walk(scope, kind);
      if (!paths.has(target)) return [];
      const result = [];
      for (let key = target; key !== null; key = paths.get(key).previous) result.push(key);
      return result.reverse();
    }

    function track(found, target, basis, edges, via) {
      const doubts = edges.filter(isUncertain).length;
      const old = found.get(target);
      if (old && old.doubts <= doubts) return;
      found.set(target, { key: target, basis, doubts, uncertain: doubts > 0, via, edges });
    }
    function siblingPaths(key) {
      const found = new Map();
      for (const { key: other, edge } of links(key)) {
        if (edge.type === 'sibling') track(found, other, 'sibling', [edge], []);
      }
      for (const parent of parents(key)) {
        for (const child of children(parent.key)) {
          if (child.key !== key) track(found, child.key, 'shared-parent', [parent.edge, child.edge], [parent.key]);
        }
      }
      return found;
    }
    function evidence(path) {
      return {
        key: path.key, basis: path.basis, uncertain: path.uncertain, via: path.via,
        edgeIds: path.edges.map(edge => edge.id),
        refs: [...new Set(path.edges.flatMap(edge => edge.refs || []))]
      };
    }
    const relativeCache = new Map();
    function relatives(key) {
      if (relativeCache.has(key)) return relativeCache.get(key);
      const auntsUncles = new Map(), cousins = new Map();
      for (const parent of parents(key)) {
        for (const sibling of siblingPaths(parent.key).values()) {
          track(auntsUncles, sibling.key, 'aunt-uncle', [parent.edge, ...sibling.edges], [parent.key, ...sibling.via]);
          for (const child of children(sibling.key)) {
            if (child.key === key) continue;
            track(cousins, child.key, 'first-cousin', [parent.edge, ...sibling.edges, child.edge],
              [parent.key, ...sibling.via, sibling.key]);
          }
        }
      }
      const result = {
        siblings: [...siblingPaths(key).values()].map(evidence),
        auntsUncles: [...auntsUncles.values()].map(evidence),
        cousins: [...cousins.values()].map(evidence)
      };
      relativeCache.set(key, result);
      return result;
    }
    // In this display, parents' siblings and first cousins belong to Max's close family.
    const family = relatives(root);
    const siblingFamily = new Set([root, ...parents(root).map(parent => parent.key)]);
    for (const relative of [...family.siblings, ...family.cousins]) {
      siblingFamily.add(relative.key);
      for (const key of relative.via) siblingFamily.add(key);
      for (const parent of parents(relative.key)) siblingFamily.add(parent.key);
    }
    const closeRelatives = new Map();
    for (const entry of [...family.siblings, ...family.auntsUncles, ...family.cousins]) {
      const previous = closeRelatives.get(entry.key);
      if (!previous || (previous.uncertain && !entry.uncertain)) closeRelatives.set(entry.key, entry);
    }
    const isCloseKin = key => upwards(root).has(key) || closeRelatives.has(key);
    // Names supply the grammatical form of the Ukrainian caption only. Family
    // membership, degree and uncertainty always come from recorded relationships.
    const femaleNames = new Set(('алла раїса ліна катерина галина євдокія ганна агафія марія єфросинія ольга ' +
      'ксенія агафья зінаїда софія антоніна фаїна ірина людмила лидия таня инна люда свєта анна ' +
      'анжела віра наташа лариса віта олімпіада татьяна любовь валентина феня анастасия дарья').split(' '));
    const maleNames = new Set(('максим денис віктор андрій олександр олексій григорій йосип данило іван ' +
      'гаврило никифор сава степан павло терентій микола борис михайло петро богдан сергій митрофан ' +
      'николай игнатий иван сергей михаил яков павел василий семен').split(' '));
    const maleRole = /^(?:(?:рідний|другий) )?(?:син|батько|тато|чоловік|брат|вітчим|пасинок)(?:$|[ ,(])/iu;
    const femaleRole = /^(?:(?:рідна|ймовірна) )?(?:донька|дочка|мати|мама|дружина|сестра|мачуха|падчерка)(?:$|[ ,(])/iu;
    function form(key) {
      const person = people.get(key);
      if (!person) return '';
      const roles = links(key).map(({edge}) => key === edge.a ? edge.roleA : edge.roleB);
      for (const term of [person.name, ...roles, (person.notes || '').replace(/^«/,'')]) {
        if (maleRole.test(term)) return 'm';
        if (femaleRole.test(term)) return 'f';
      }
      if (/ім’я матері/iu.test(person.name)) return 'f';
      const tokens = person.name.split(/[(,]/,1)[0].toLocaleLowerCase('uk').match(/[\p{L}]+/gu) || [];
      for (const token of tokens) {
        if (femaleNames.has(token)) return 'f';
        if (maleNames.has(token)) return 'm';
      }
      return '';
    }

    const upwardCache = new Map();
    function upwards(start) {
      if (upwardCache.has(start)) return upwardCache.get(start);
      const found = new Map([[start,{path:[start],doubts:0}]]);
      const todo = [start];
      for (let i=0; i<todo.length; i++) {
        const current = found.get(todo[i]);
        for (const {key,edge} of parents(todo[i])) {
          if (current.path.includes(key)) continue;
          const depth = current.path.length, doubts = current.doubts + Number(isUncertain(edge));
          const old = found.get(key);
          if (old && (old.doubts < doubts || (old.doubts === doubts && old.path.length <= depth+1))) continue;
          found.set(key,{path:[...current.path,key],doubts}); todo.push(key);
        }
      }
      upwardCache.set(start,found); return found;
    }

    // Compare two ascending lines. An explicit sibling link can establish a
    // common generation even where the parents of those siblings are unnamed.
    const kinCache = new Map();
    function bloodConnection(key, from = root) {
      if (!kinCache.has(from)) kinCache.set(from,new Map());
      const cache = kinCache.get(from);
      if (cache.has(key)) return cache.get(key);
      let best = null;
      const theirAncestors = upwards(key);
      function consider(ours, theirs, ancestor, siblingEdge) {
        if (!theirs) return;
        const extra = siblingEdge ? 1 : 0;
        const up = ours.path.length-1+extra, down = theirs.path.length-1+extra;
        const distance = up+down, doubts = ours.doubts+theirs.doubts+Number(Boolean(siblingEdge && isUncertain(siblingEdge)));
        if (best && (best.doubts < doubts || (best.doubts === doubts && best.distance < distance))) return;
        const tied = best && best.doubts === doubts && best.distance === distance;
        const ancestors = tied ? best.ancestors : new Set();
        if (ancestor) ancestors.add(ancestor);
        if (tied && (best.ancestor || !ancestor)) return;
        best = {up, down, ours:ours.path, theirs:theirs.path, ancestor, ancestors, distance, doubts};
      }
      for (const [anchor,ourLine] of upwards(from)) {
        consider(ourLine,theirAncestors.get(anchor),anchor);
        for (const {key:other,edge} of links(anchor)) {
          if (edge.type === 'sibling') consider(ourLine,theirAncestors.get(other),null,edge);
        }
      }
      cache.set(key,best);
      return best;
    }
    function commonAncestors(key) {
      const connection = people.has(key) && bloodConnection(key);
      return connection && !connection.doubts && connection.up && connection.down ? [...connection.ancestors] : [];
    }
    const commonAncestor = key => commonAncestors(key)[0] ?? null;

    // Follow parentage up, then down. Going back up from a cousin or a spouse
    // would pull that person's other family into the selected person's tree.
    function familyMembers(key) {
      const ancestors = [...upwards(key).keys()];
      const descendants = new Set(ancestors);
      for (const ancestor of ancestors) {
        for (const relative of links(ancestor)) {
          if (relative.edge.type === 'sibling') descendants.add(relative.key);
        }
      }
      for (const ancestor of descendants) {
        for (const child of children(ancestor)) descendants.add(child.key);
      }
      const members = new Set(descendants);
      for (const relative of links(key)) {
        members.add(relative.key);
        if (relative.edge.type === 'spouse') {
          for (const child of children(relative.key)) members.add(child.key);
        }
      }
      for (const member of descendants) {
        for (const relative of links(member)) {
          if (relative.edge.type === 'spouse') members.add(relative.key);
        }
      }
      return members;
    }

    function connectionToRoot(key) {
      const routes = walk('all','everyone');
      const steps = [];
      if (!routes.has(key)) return steps;
      const blood = bloodConnection(key);
      // Prefer the documented line through a shared ancestor when a marriage
      // also provides a shortcut. Keep a better-supported fallback if needed.
      if (blood && blood.doubts <= routes.get(key).doubts) {
        const ascending = blood.theirs;
        const descending = [...blood.ours].reverse();
        for (let i = 1; i < ascending.length; i++) {
          const parent = parents(ascending[i-1]).find(link => link.key === ascending[i]);
          steps.push(parent);
        }
        if (ascending.at(-1) !== descending[0]) {
          steps.push(links(ascending.at(-1)).find(link => link.key === descending[0] && link.edge.type === 'sibling'));
        }
        for (let i = 1; i < descending.length; i++) {
          steps.push(children(descending[i-1]).find(link => link.key === descending[i]));
        }
      } else {
        for (let current = key; current !== root;) {
          const {previous,edge} = routes.get(current);
          steps.push({key:previous,edge});
          current = previous;
        }
      }
      return [{key,edge:null,role:''}, ...steps.map(({key,edge}) => {
        const explicit = key === edge.a ? edge.roleA : edge.roleB;
        const role = explicit || capitalise(nextToKin(edge,key)?.[0] || 'родинний зв’язок');
        return {key,edge,role};
      })];
    }

    // Each pair is nominative (the card itself) and genitive (in a longer caption).
    const words = (gender, male, female, neutral) => gender === 'm' ? male : gender === 'f' ? female : neutral;
    function ancestorTerm(depth,gender) {
      if (depth === 1) return words(gender,['тато','тата'],['мама','мами'],['хтось із батьків','одного з батьків']);
      const prefix = 'пра'.repeat(depth-2);
      return words(gender,[prefix+'дідусь',prefix+'дідуся'],[prefix+'бабуся',prefix+'бабусі'],
        ['предок '+depth+'-го покоління','предка '+depth+'-го покоління']);
    }
    function descendantTerm(depth,gender) {
      if (depth === 1) return words(gender,['син','сина'],['донька','доньки'],['дитина','дитини']);
      const prefix = 'пра'.repeat(depth-2);
      return words(gender,[prefix+'онук',prefix+'онука'],[prefix+'онука',prefix+'онуки'],['нащадок','нащадка']);
    }
    const degreeStems = ['', '', 'дво', 'тро', 'чотири', 'п’яти', 'шести', 'семи', 'восьми', 'дев’яти', 'десяти'];
    function siblingTerm(degree,gender) {
      const stem = degree === 1 ? '' : degreeStems[degree] && degreeStems[degree]+'юрідн';
      if (stem === undefined) return ['далека рідня','далекої рідні'];
      const inflect = ending => stem ? stem+ending+' ' : '';
      return words(gender,[inflect('ий')+'брат',inflect('ого')+'брата'],
        [inflect('а')+'сестра',inflect('ої')+'сестри'],
        [inflect('ий')+'брат або сестра',inflect('ого')+'брата або сестри']);
    }
    const of = (pair,owner) => pair.map(word=>word+' '+owner[1]);
    const nephewTerm = gender => words(gender,['племінник','племінника'],['племінниця','племінниці'],
      ['племінник чи племінниця','племінника чи племінниці']);
    function bloodTerm(c,key) {
      const gender = form(key);
      if (!c.down) return ancestorTerm(c.up,gender);
      if (!c.up) return descendantTerm(c.down,gender);
      const degree = Math.min(c.up,c.down), delta = c.up-c.down;
      if (!delta) return siblingTerm(degree,gender);
      if (delta > 0) {
        const elder = ancestorTerm(delta,form(c.ours[delta]));
        if (delta === 1 && degree === 1 && gender) {
          const term = gender === 'f' ? ['тітка','тітки'] : ['дядько','дядька'];
          return [term[0]+' · '+of(siblingTerm(1,gender),elder)[0],term[1]];
        }
        return of(siblingTerm(degree,gender),elder);
      }
      if (degree === 1 && delta === -1) return nephewTerm(gender);
      const cousin = siblingTerm(degree,form(c.theirs[-delta]));
      return of(descendantTerm(-delta,gender),cousin);
    }

    function nextToKin(edge,key) {
      const gender = form(key);
      if (edge.type === 'stepparent' && edge.a === key) {
        return words(gender,['вітчим','вітчима'],['мачуха','мачухи'],['нерідні батьки','нерідних батьків']);
      }
      if (edge.type === 'stepparent') return words(gender,['пасинок','пасинка'],['падчерка','падчерки'],['нерідна дитина','нерідної дитини']);
      if (edge.type === 'spouse') return words(gender,['чоловік','чоловіка'],['дружина','дружини'],['партнер у шлюбі','партнера у шлюбі']);
      if (edge.type === 'sibling') return siblingTerm(1,gender);
      if (edge.type === 'parent' && edge.a === key) return words(gender,['батько','батька'],['мати','матері'],['хтось із батьків','одного з батьків']);
      if (edge.type === 'parent') return descendantTerm(1,gender);
      return null;
    }
    const capitalise = text => text[0].toLocaleUpperCase('uk')+text.slice(1);
    function sharedParentSide(key) {
      const confirmed = child => new Set(parents(child).filter(link => !isUncertain(link.edge)).map(link => link.key));
      const ours = confirmed(root), theirs = confirmed(key);
      if (ours.size !== 2 || theirs.size !== 2) return '';
      const shared = [...ours].filter(parent => theirs.has(parent));
      if (shared.length !== 1) return '';
      return words(form(shared[0]), ' по татові', ' по мамі', '');
    }
    function closeRelativeLabel(key, entry, short) {
      const gender = form(key);
      if (entry.basis === 'aunt-uncle') {
        const role = words(gender, 'Дядько', 'Тітка', 'Дядько чи тітка');
        const parent = ancestorTerm(1, form(entry.via[0]));
        const detail = short ? '' : ' · '+of(siblingTerm(1,gender),parent)[0];
        return role + detail + (entry.uncertain ? ' · імовірно' : '');
      }
      const cousin = entry.basis === 'first-cousin';
      const role = siblingTerm(cousin ? 2 : 1,gender)[0];
      if (cousin && entry.uncertain) {
        const quoted = root === 'root' && people.get(key).notes?.match(/^«(двоюрідний брат|сестра двоюрідна)»/iu);
        if (quoted) return (quoted[1].toLowerCase().includes('сестра') ? 'Двоюрідна сестра' : 'Двоюрідний брат')+' за підписом';
        return 'Можлив' + words(gender,'ий ','а ','е ') + (gender ? role : 'двоюрідне споріднення');
      }
      return capitalise(role) + (cousin ? '' : sharedParentSide(key)) + (entry.uncertain ? ' · імовірно' : '');
    }
    // Describe each stretch of blood kinship from its own starting person.
    // A marriage or step relationship starts a new stretch. Thus the same
    // edges read as "wife of brother" going out and "sister of husband" back.
    function routeCaption(key) {
      const chain = pathTo(key);
      const routes = walk('all','everyone');
      let term = null, uncertain = false;
      for (let i = 1; i < chain.length; i++) {
        const edge = routes.get(chain[i]).edge;
        let part = nextToKin(edge,chain[i]);
        let doubtful = isUncertain(edge);
        if (edge.type === 'parent' || edge.type === 'sibling') {
          const start = chain[i-1];
          const first = start === root && bloodConnection(chain[i],start);
          if (first && first.doubts <= Number(doubtful)) {
            part = bloodTerm(first,chain[i]);
            doubtful = first.doubts > 0;
          }
          // Co-parents can be connected through a child without any documented
          // marriage. Keep the two steps when there is no blood relationship.
          let j = i, routeDoubts = Number(isUncertain(edge));
          while (j + 1 < chain.length) {
            const next = chain[j+1], nextEdge = routes.get(next).edge;
            if (nextEdge.type !== 'parent' && nextEdge.type !== 'sibling') break;
            routeDoubts += Number(isUncertain(nextEdge));
            const kin = bloodConnection(next,start);
            if (!kin || kin.doubts > routeDoubts) break;
            part = bloodTerm(kin,next);
            doubtful = kin.doubts > 0;
            j++;
          }
          i = j;
        }
        if (!part) return term ? 'Неясний зв’язок у родині '+term[1] : 'Спорідненість уточнюється';
        term = term ? of([part[0].split(' · ')[0],part[1]],term) : part;
        uncertain ||= doubtful;
      }
      return term ? capitalise(term[0]) + (uncertain ? ' · імовірно' : '') : 'Спорідненість уточнюється';
    }
    function caption(key, short = false) {
      if (!people.has(key)) return '';
      if (key === root) return root === 'root' ? 'Це ти' : 'Вибрана людина';
      if (!upwards(root).has(key) && closeRelatives.has(key)) return closeRelativeLabel(key,closeRelatives.get(key),short);
      const kin = bloodConnection(key);
      if (kin && (!kin.doubts || kin.doubts <= walk('all','everyone').get(key).doubts)) {
        const label = bloodTerm(kin,key)[0];
        return capitalise(label) + (kin.doubts ? ' · імовірно' : '');
      }
      // Preserve the actual steps through marriage or a stepparent. They
      // cannot establish a cousin degree or add a person to the direct line.
      return routeCaption(key);
    }
    // More distant relatives are introduced by their relationship to a named ancestor.
    function compareRanks(a,b) {
      for (let i=0;i<a.length;i++) if (a[i] !== b[i]) return a[i]-b[i];
      return 0;
    }
    function childWord(depth,gender) {
      if (depth === 1) return descendantTerm(1,gender);
      if (depth === 2) return words(gender,['онук','онука'],['онука','онуки'],['онук чи онука','онука чи онуки']);
      const prefix = 'пра'.repeat(depth-2);
      return words(gender,[prefix+'внук',prefix+'внука'],[prefix+'внучка',prefix+'внучки'],
        [prefix+'внук чи '+prefix+'внучка',prefix+'внука чи '+prefix+'внучки']);
    }
    function localRelationship(path) {
      const terms = [];
      const childStep = ({edge,key}) => edge.type === 'parent' && edge.b === key;
      for (let i=0; i<path.length; i++) {
        const step = path[i];
        if (step.edge.type === 'other') return null;
        if (step.edge.type === 'sibling' && path[i+1] && childStep(path[i+1])) {
          const gender = form(path[++i].key);
          terms.push(nephewTerm(gender));
        } else if (childStep(step)) {
          const first = i;
          while (path[i+1] && childStep(path[i+1])) i++;
          terms.push(childWord(i-first+1,form(path[i].key)));
        } else {
          const part = nextToKin(step.edge,step.key);
          if (!part) return null;
          terms.push(part);
        }
      }
      return terms.reverse().map((term,i)=>term[i ? 1 : 0]);
    }
    const labelCache = new Map();
    let collateralLabels;
    function buildCollateralLabels() {
      const direct = upwards(root);
      const anchors = [...direct.keys()].filter(key=>key!==root);
      const directPeople = anchors.map(key=>people.get(key));
      const best = new Map();
      const edgePriority = {sibling:0,stepparent:1,parent:2,spouse:3,other:4};
      for (const anchor of anchors) {
        if (links(anchor).every(({key})=>direct.has(key))) continue;
        const name = window.AncestorNames.forPerson(people.get(anchor),directPeople);
        const anchorLine = direct.get(anchor);
        const queue = [{key:anchor,path:[],rank:[anchorLine.doubts,0]}];
        const reached = new Set([anchor]);
        while (queue.length) {
          queue.sort((a,b)=>compareRanks(a.rank,b.rank));
          const current = queue.shift();
          if (current.path.length) {
            if (reached.has(current.key)) continue;
            reached.add(current.key);
            const terms = localRelationship(current.path);
            const doubt = current.rank[0] > 0;
            let text;
            if (!terms) text = name.genitive ? 'Родина '+name.genitive+' · зв’язок неясний' : 'Зв’язок із цією гілкою неясний';
            else {
              const role = capitalise(terms.join(' '));
              const reference = name.genitive || ('· гілка «'+name.name+'»');
              text = role+' '+reference+(doubt ? ' · імовірно' : '');
            }
            // Prefer sound evidence, then the nearest anchor and the shortest
            // explanation. For equally close siblings, prefer the sibling named
            // on the sheet to a parent farther back on the direct line.
            const rank = [Number(!terms),...current.rank,terms?.length || 0,
              edgePriority[current.path[0].edge.type] ?? 5,anchorLine.path.length];
            const old = best.get(current.key);
            if (!old || compareRanks(rank,old.rank)<0) best.set(current.key,{rank,text,ancestorKey:anchor});
          }
          for (const step of links(current.key)) {
            if (direct.has(step.key) || reached.has(step.key)) continue;
            queue.push({key:step.key,path:[...current.path,step],
              rank:[current.rank[0]+Number(isUncertain(step.edge)),current.rank[1]+1]});
          }
        }
      }
      return best;
    }
    function cardLabel(key) {
      if (!people.has(key)) return {text:'',ancestorKey:null};
      if (labelCache.has(key)) return labelCache.get(key);
      const line = upwards(root).get(key);
      let text, ancestorKey = null;
      // Individual family views describe everyone from the selected person's
      // perspective. Named ancestor anchors belong to the whole-tree overview.
      if (focused || key === root) text = caption(key, true);
      else if (line) {
        const term = ancestorTerm(line.path.length-1,form(key))[0];
        text = capitalise(term)+(line.doubts ? ' · імовірно' : '');
      } else if (closeRelatives.has(key)) {
        text = closeRelativeLabel(key,closeRelatives.get(key),true);
      } else if (links(key).some(({key:partner,edge}) => {
        if (edge.type !== 'spouse' || isUncertain(edge)) return false;
        const relative = closeRelatives.get(partner);
        return (relative?.basis === 'aunt-uncle' && !relative.uncertain) ||
          parents(root).some(link => link.key === partner && !isUncertain(link.edge));
      })) {
        text = caption(key);
      } else if (parents(key).some(({key:parentKey,edge}) => {
        const relative = closeRelatives.get(parentKey);
        return relative?.basis === 'first-cousin' && !relative.uncertain && !isUncertain(edge);
      })) {
        text = caption(key);
      } else {
        collateralLabels ??= buildCollateralLabels();
        const choice = collateralLabels.get(key);
        text = choice ? choice.text : caption(key);
        ancestorKey = choice?.ancestorKey ?? null;
      }
      const label = {text,ancestorKey};
      labelCache.set(key,label);
      return label;
    }
    return { eligible, initial, expand, hiddenNeighbors, pathTo, relatives, caption, cardLabel, commonAncestor, commonAncestors, familyMembers, connectionToRoot };
  }
  window.TreeBranches = { create };
})();
