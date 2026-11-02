// Lección de un curso de DKS (Digital Kneeboard Simulator) ligada a la misión:
// si el nombre de la misión lleva el código de la lección (p. ej. «TIE-1»), se abre sola.
// Página 1: perfil, objetivos y tareas para marcar en vuelo. Página 2: notas. Página 3: hoja de evaluación.
import { icon } from '../icons.js';
import { h, clear, emptyState, mdToHtml } from '../util.js';

const LEVEL = {
  INTRODUCE: { t: 'I', label: 'Introducir' },
  PRACTICE: { t: 'P', label: 'Practicar' },
  DEMONSTRATE: { t: 'D', label: 'Demostrar' },
};
const KIND = { LECTURE: 'Clase', SORTIE: 'Salida', SIM: 'Simulador', MILESTONE: 'Hito' };

export function flattenLessons(course) {
  const out = [];
  for (const ph of (course && course.phases) || []) {
    for (const mod of ph.modules || []) {
      for (const l of mod.lessons || []) out.push({ ...l, phase: ph, module: mod });
    }
  }
  return out.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
}

// Busca el código de una lección en el nombre de la misión o del archivo.
export function detectLesson(lessons, text) {
  const t = String(text || '');
  if (!t) return null;
  const cands = lessons.filter((l) => l.code && (l.code.length >= 4 || /[-\d]/.test(l.code)))
    .sort((a, b) => b.code.length - a.code.length);
  for (const l of cands) {
    const esc = l.code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(^|[^A-Za-z0-9])${esc}([^A-Za-z0-9]|$)`, 'i').test(t)) return l;
  }
  return null;
}

export const lesson = {
  icon: 'lesson',
  label: 'Lección del curso (DKS)',
  create(ctx, tab) {
    const el = h('div');
    let page = 0;
    let course = null;
    let lessons = [];
    let code = null;
    let auto = false;
    let store = {};

    const courseId = () => (course && course.course && (course.course.identifier || course.course.title)) || 'curso';
    const state = () => {
      const k = `${courseId()}:${code}`;
      return (store[k] = store[k] || { done: {}, grades: {}, comments: {}, note: '' });
    };
    const save = () => ctx.kb.storeSet('lessons', store);

    async function init() {
      course = await ctx.kb.courseGet();
      store = (await ctx.kb.storeGet('lessons')) || {};
      setCourse(course);
    }

    function setCourse(c) {
      course = c && !c.error ? c : null;
      lessons = flattenLessons(course);
      code = (ctx.S.config.course || {}).lesson || null;
      detect();
      render();
      ctx.refresh();
    }

    function detect() {
      const m = ctx.S.mission;
      if (!m || !(ctx.S.config.course || {}).auto) return;
      const file = (m.file || '').split(/[\\/]/).pop();
      const found = detectLesson(lessons, `${m.name || ''} ${file}`);
      if (found && found.code !== code) {
        code = found.code;
        auto = true;
        ctx.toast(`Lección ${found.code} · ${found.title}`);
      }
    }

    function current() {
      return lessons.find((l) => l.code === code) || null;
    }

    function selector() {
      const sel = h('select.f', { style: { width: 'auto', maxWidth: '100%', fontFamily: 'var(--font-ui)' }, onchange: (e) => {
        code = e.target.value || null;
        auto = false;
        ctx.kb.patchConfig({ course: { lesson: code } });
        render();
      } }, h('option', { value: '' }, 'Elige la lección…'));
      for (const ph of course.phases) {
        const g = h('optgroup', { label: `${ph.code} · ${ph.name}` });
        for (const mod of ph.modules || []) {
          for (const l of mod.lessons || []) g.append(h('option', { value: l.code, selected: l.code === code }, `${l.code} — ${l.title}`));
        }
        sel.append(g);
      }
      return sel;
    }

    function objName(oc) {
      const list = course.objectives || [];
      const o = list.find((x) => x.code && x.code === oc.code) || (oc.objectiveId ? list.find((x) => x.id === oc.objectiveId) : null);
      return o ? o.name : oc.code;
    }

    function taskList(tasks, st, depth = 0) {
      return h('div', { style: { marginLeft: depth ? '1.4rem' : 0 } }, tasks.map((t) => h('div',
        h('label', { style: { display: 'flex', gap: '.55rem', alignItems: 'flex-start', padding: '.28rem 0', cursor: 'pointer', borderBottom: depth ? 'none' : '1px solid var(--line-soft, var(--line))' } },
          h('input', { type: 'checkbox', checked: !!st.done[t.id], style: { width: '1.1rem', height: '1.1rem', marginTop: '.15rem', accentColor: 'var(--accent)' },
            onchange: (e) => { st.done[t.id] = e.target.checked; save(); } }),
          h('span', t.label, t.optional ? h('span.tag', { style: { marginLeft: '.4rem' } }, 'opcional') : null,
            t.creditNote ? h('div.muted', { style: { fontSize: '.75rem' } }, t.creditNote) : null)),
        t.children ? taskList(t.children, st, depth + 1) : null)));
    }

    function pageLesson(l) {
      const st = state();
      el.append(
        h('div.h1', `${l.code}`, h('small', l.title)),
        h('div.chips',
          h('span.tag', KIND[l.kind] || l.kind), l.isEvaluation ? h('span.tag', { style: { background: 'var(--accent)', color: 'var(--accent-ink)' } }, 'Evaluación') : null,
          l.durationHours ? h('span.tag', `${l.durationHours} h`) : null, l.lineup ? h('span.tag', l.lineup) : null,
          h('span.muted', { style: { fontSize: '.75rem' } }, `${l.phase.code} › ${l.module.name}`), auto ? h('span.tag', 'detectada por la misión') : null),
        l.profile ? h('div.card', { html: mdToHtml(l.profile) }) : null,
        l.objectives && l.objectives.length ? h('div.card',
          h('div.label', 'Objetivos'),
          l.objectives.map((o) => h('div.card-row', { style: { padding: '.2rem 0' } },
            h('span.tag', { title: (LEVEL[o.level] || {}).label }, `${(LEVEL[o.level] || {}).t || '?'}`),
            h('b', { style: { fontFamily: 'var(--font-mono)', fontSize: '.8rem', minWidth: '3.4rem' } }, o.code),
            h('span', objName(o))))) : null,
        l.tasks && l.tasks.length ? h('div.card', h('div.card-row', h('div.label', 'Tareas'), h('span.bar-spacer'),
          h('button.btn.small', { onclick: () => { st.done = {}; save(); render(); } }, 'Desmarcar')), taskList(l.tasks, st)) : null,
        (l.prereqs || []).length ? h('div.muted', { style: { fontSize: '.75rem' } }, `Requisitos: ${l.prereqs.map((p) => p.code).join(', ')}`) : null,
      );
    }

    function pageNotes(l) {
      el.append(h('div.h1', 'Notas', h('small', `${l.code} · ${l.title}`)));
      const notes = l.notes || [];
      if (!notes.length && !(l.readings || []).length) el.append(h('div.card.muted', 'Esta lección no tiene notas ni lecturas.'));
      for (const n of notes) el.append(h('div.card.md', { html: mdToHtml(n) }));
      const mats = [...(l.readings || []), ...((course.materials || []).filter((m) => (l.readings || []).some((r) => r.materialId === m.id)))];
      if (mats.length) {
        el.append(h('div.card', h('div.label', 'Lecturas'), mats.map((m) => h('div.card-row', icon('doc'), h('span', m.title || m.name || m.label || ''),
          m.url ? h('button.btn.small', { onclick: () => ctx.kb.openExternal(m.url) }, 'Abrir') : null))));
      }
      const st = state();
      const ta = h('textarea.f', { rows: 4, value: st.note || '', placeholder: 'Tus notas de esta lección…' });
      ta.addEventListener('input', () => { st.note = ta.value; save(); });
      el.append(h('div.card', h('div.label', 'Mis notas'), ta));
    }

    function pageGrade(l) {
      const st = state();
      const scale = (course.course && course.course.gradeScale) || { minPass: 2, levels: [0, 1, 2, 3].map((v) => ({ value: v, label: String(v) })) };
      el.append(h('div.h1', 'Hoja de evaluación', h('small', `${l.code} · ${l.title}`)));
      if (!(l.objectives || []).length) {
        el.append(h('div.card.muted', 'Esta lección no tiene objetivos que evaluar.'));
        return;
      }
      const graded = l.objectives.filter((o) => st.grades[o.code] != null);
      const failed = graded.filter((o) => st.grades[o.code] < scale.minPass);
      el.append(h('div.card-row', { style: { marginBottom: '.6rem' } },
        h('span.tag', `${graded.length}/${l.objectives.length} evaluados`),
        graded.length === l.objectives.length ? h('span.tag', { style: { background: failed.length ? 'var(--warn)' : 'var(--ok)', color: '#000' } }, failed.length ? 'No supera' : 'Supera') : null,
        h('span.muted', { style: { fontSize: '.72rem' } }, `Aprueba con ${scale.minPass}`)));
      for (const o of l.objectives) {
        const cm = h('input.f', { value: st.comments[o.code] || '', placeholder: 'Comentario', style: { fontSize: '.8rem', marginTop: '.3rem' } });
        cm.addEventListener('input', () => { st.comments[o.code] = cm.value; save(); });
        el.append(h('div.card',
          h('div.card-row', h('span.tag', (LEVEL[o.level] || {}).t || '?'), h('b', o.code), h('span', objName(o))),
          h('div.chips', { style: { margin: '.4rem 0 0' } }, scale.levels.map((lv) => h('button.chip', {
            className: `chip${st.grades[o.code] === lv.value ? ' sel' : ''}`, title: lv.description || '',
            onclick: () => { st.grades[o.code] = st.grades[o.code] === lv.value ? null : lv.value; save(); render(); },
          }, lv.label))),
          cm));
      }
      el.append(h('button.btn', { onclick: () => {
        const lines = l.objectives.map((o) => `${o.code} (${(LEVEL[o.level] || {}).t}): ${st.grades[o.code] ?? '—'}${st.comments[o.code] ? ` · ${st.comments[o.code]}` : ''}`);
        ctx.kb.shareSend({ type: 'note', title: `Evaluación ${l.code}`, text: lines.join('\n') }).then((ok) => ok && ctx.toast('Hoja enviada al vuelo'));
      } }, icon('send'), ' Enviar la hoja al vuelo'));
    }

    function render() {
      clear(el);
      if (!course) {
        el.append(emptyState(icon('lesson'), 'Sin curso', 'Carga el curso de DKS (archivo .json) en Ajustes > Misión. La lección se elige sola si el nombre de la misión lleva su código (p. ej. «TIE-1»).'));
        return;
      }
      el.append(h('div', { style: { marginBottom: '.6rem' } }, selector()));
      const l = current();
      if (!l) {
        el.append(h('div.card.muted', `Curso ${courseId()}: ${lessons.length} lecciones. Elige una arriba o pon su código en el nombre de la misión.`));
        return;
      }
      if (page === 0) pageLesson(l);
      else if (page === 1) pageNotes(l);
      else pageGrade(l);
    }

    init();
    ctx.kb.on('course', setCourse);
    return {
      el,
      pages: () => (current() ? 3 : 1),
      show(p) { page = p; render(); },
      title: (p) => ['Lección', 'Notas de la lección', 'Hoja de evaluación'][p] || 'Lección',
      onMission: () => { detect(); render(); },
    };
  },
};
