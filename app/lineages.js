/* Visual branches of a family. Keys identify people in the source records. */
window.Lineages = (() => {
  'use strict';

  function compare(a,b) {
    return a.doubts-b.doubts || a.household-b.household || a.steps-b.steps;
  }

  function create(data, root = 'root') {
    const people = new Map(data.people.map(p=>[p.key,p]));
    const links = new Map(data.people.map(p=>[p.key,[]]));
    const parents = new Map(data.people.map(p=>[p.key,[]]));
    for (const edge of data.edges) {
      if (!people.has(edge.a) || !people.has(edge.b)) continue;
      links.get(edge.a).push({key:edge.b,edge});
      links.get(edge.b).push({key:edge.a,edge});
      if (edge.type === 'parent') parents.get(edge.b).push(edge.a);
    }

    // Above the grandparents the recorded lines separate. Do not carry either
    // parent's branch through the point at which those lines converge.
    const rootParents = parents.get(root) || [];
    const junctions = new Set([root,...rootParents,...rootParents.flatMap(k=>parents.get(k))]);
    const groups = (data.lineages || []).filter(group=>group.anchors.some(key=>people.has(key)));
    const anchors = new Map(groups.flatMap(group=>group.anchors.map(key=>[key,group])));
    const owners = new Map();

    for (const group of groups) {
      const paths = new Map();
      const queue = [];
      for (const key of group.anchors) {
        if (!people.has(key) || junctions.has(key)) continue;
        paths.set(key,{doubts:0,household:0,steps:0});
        queue.push(key);
      }
      for (let i=0; i<queue.length; i++) {
        const key = queue[i], current = paths.get(key);
        for (const {key:next,edge} of links.get(key)) {
          if (junctions.has(next) || people.get(next).branch !== group.side) continue;
          if (anchors.has(next) && anchors.get(next) !== group) continue;
          const candidate = {
            doubts:current.doubts + Number(Boolean(edge.uncertain || edge.status === 'unresolved')),
            household:current.household + Number(edge.type !== 'parent' && edge.type !== 'sibling'),
            steps:current.steps + 1
          };
          const earlier = paths.get(next);
          if (!earlier || compare(candidate,earlier) < 0) {
            paths.set(next,candidate);
            queue.push(next);
          }
        }
      }

      // Prefer supported parent/sibling routes. A marriage, step or uncertain
      // link may locate a card in a branch without changing the relationship.
      for (const [key,rank] of paths) {
        const owner = owners.get(key);
        if (!owner || compare(rank,owner.rank) < 0) owners.set(key,{group,rank});
        else if (compare(rank,owner.rank) === 0) owner.group = null;
      }
    }
    return {groups, forPerson:key=>owners.get(key)?.group || null};
  }

  return {create};
})();
