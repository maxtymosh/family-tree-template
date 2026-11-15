'use strict';

window.PersonEvidence = {
  create({sources, people = [], edges = []}) {
    const names = new Map(people.map(person => [person.key, person.name]));
    const familyKinds = new Set([
      'user-testimony', 'family-testimony', 'family-video-interview',
      'family-manuscript-photo', 'private-correspondence', 'family-photograph', 'family-photo-group'
    ]);
    const sourceIndexes = new Map(sources.map((source, index) => [source.id, index]));
    const cache = new WeakMap();
    const empty = () => ({summary: [], sections: []});

    function forPerson(person) {
      if (cache.has(person)) return cache.get(person);
      const linked = person.refs || [];
      const workRefs = (person.professions || []).flatMap(entry => entry.refs.map(ref => ref.source));
      const familyRefs = new Set([...linked, ...workRefs, ...(person.memories || []).map(m => m.source)]
        .filter(i => !sources[i]?.archive && familyKinds.has(sources[i]?.kind)));
      const confirmed = new Set((person.confirmedArchives || [])
        .filter(i => linked.includes(i) && sources[i]?.archive));
      const evidence = {memory: familyRefs.size > 0, archive: confirmed.size > 0, familyRefs, confirmed};
      cache.set(person, evidence);
      return evidence;
    }

    function forMapEvent(person, event) {
      const result = {memory: [], archive: []};
      const confirmed = person ? forPerson(person).confirmed : new Set();
      for (const id of new Set(event.sourceIds || [])) {
        const index = sourceIndexes.get(id);
        const source = sources[index];
        if (!source) continue;
        // Geography owns event-level family citations, including ones absent from a person's summary.
        if (!source.archive && familyKinds.has(source.kind)) result.memory.push(id);
        // A documented place/event can still belong to a namesake. Personal identification owns this gate.
        if (confirmed.has(index)) result.archive.push(id);
      }
      return result;
    }

    function kindsFor(person, paragraph) {
      const {familyRefs, confirmed} = forPerson(person);
      const refs = paragraph.refs || [];
      const kinds = [];
      if (refs.some(r => familyRefs.has(r.source))) kinds.push('memory');
      if (refs.some(r => confirmed.has(r.source))) kinds.push('archive');
      return kinds;
    }

    function professionsFor(person, mode) {
      const entries = person.professions || [];
      if (mode === 'all') return entries;
      const proof = forPerson(person);
      const allowed = mode === 'memory' ? proof.familyRefs : proof.confirmed;
      // Career entries group details with their supporting sources, just like history paragraphs.
      return entries.filter(entry => entry.refs.length && entry.refs.every(ref => allowed.has(ref.source)));
    }

    function historyFor(person, mode) {
      const history = person.history || empty();
      if (mode === 'all') return history;
      const evidence = forPerson(person);
      const allowed = mode === 'memory' ? evidence.familyRefs : evidence.confirmed;
      if (!allowed.size) return empty();

      // A citation applies to a whole paragraph. Without sentence-level attribution,
      // retain a mixed account in the combined view with all its original footnotes.
      const belongs = para => para.refs?.length && para.refs.every(r => allowed.has(r.source));
      const opening = history.summary.filter(belongs);
      const sections = history.sections.map(section => ({
        title: section.title, paragraphs: section.paragraphs.filter(belongs)
      })).filter(section => section.paragraphs.length);
      const passages = sections.flatMap(section => section.paragraphs);
      const covered = [...opening, ...passages].flatMap(para => para.refs);
      const additions = [];
      if (mode === 'memory') {
        for (const {source, seconds, text} of person.memories || []) {
          if (text && allowed.has(source) && !covered.some(r => r.source === source && r.seconds === seconds)) {
            additions.push({text, refs: [{source, seconds}]});
          }
        }
        // Jointly cited family paragraphs may combine relatives established by
        // different sources. Each individual edge retains its own source list.
        if (!opening.length && !passages.length && !additions.length) {
          for (const edge of edges) {
            if (edge.a !== person.key && edge.b !== person.key) continue;
            const other = edge.a === person.key ? edge.b : edge.a;
            const refs = (edge.refs || []).filter(i => allowed.has(i)).map(source => ({source}));
            if (!refs.length || !names.has(other)) continue;
            const labels = {parent: edge.a === person.key ? 'Діти' : 'Батьки', spouse: 'Подружжя',
              sibling: 'Брати й сестри', stepparent: 'Нерідне батьківство'};
            const label = labels[edge.type] || 'Родинний зв’язок';
            const text = label + ' — ' + names.get(other) + (edge.uncertain ? ' (спорідненість уточнюється).' : '.');
            additions.push({text, refs});
          }
        }
      } else {
        const byNote = new Map();
        for (const source of allowed) {
          if (covered.some(r => r.source === source)) continue;
          const text = person.archiveNotes?.[source];
          if (!text) continue;
          if (!byNote.has(text)) byNote.set(text, {text, refs: []});
          byNote.get(text).refs.push({source});
        }
        additions.push(...byNote.values());
      }
      if (!passages.length && opening.length) sections.push({title: 'Життєпис', paragraphs: opening});
      if (additions.length) {
        sections.push({title: mode === 'memory' ? 'З родинних джерел' : 'Що засвідчують документи',
          paragraphs: additions});
      }
      const summary = [];
      for (const para of [...opening, ...passages, ...additions]) {
        if (!summary.some(item => item.text === para.text)) summary.push(para);
        if (summary.length === 3) break;
      }
      return {summary, sections};
    }

    return {forPerson, forMapEvent, kindsFor, historyFor, professionsFor};
  }
};
