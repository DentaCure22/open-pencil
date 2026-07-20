import { createRouter, createWebHistory } from 'vue-router'

import EditorView from './views/EditorView.vue'

const base = import.meta.env.BASE_URL || '/'

const router = createRouter({
  history: createWebHistory(base),
  routes: [
    { path: '/', component: EditorView },
    { path: '/demo', component: EditorView, meta: { demo: true } },
    { path: '/share/:roomId', component: EditorView },
    // Catch-all so /open-pencil (no trailing slash) and unknown subpaths still boot the editor
    { path: '/:pathMatch(.*)*', component: EditorView }
  ]
})

export default router
