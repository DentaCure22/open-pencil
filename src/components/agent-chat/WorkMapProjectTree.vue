<script setup lang="ts">
import type { AgentWorkMapSurfaceController } from '@/app/agent-chat/work-map-surface-controller'
import type { WorkMapViewEntry } from '@/app/agent-chat/work-map-view'
import { buildSpeechDictationContext } from '@/app/speech-dictation-context'
import AiPromptInput from '@/components/ai-elements/AiPromptInput.vue'
import AgentThreadStatusIndicator from '@/components/agent-chat/AgentThreadStatusIndicator.vue'
import WorkMapBotIcon from '@/components/agent-chat/WorkMapBotIcon.vue'
import WorkMapProjectChats from '@/components/agent-chat/WorkMapProjectChats.vue'
import WorkMapScheduledSection from '@/components/agent-chat/WorkMapScheduledSection.vue'
import Tip from '@/components/ui/Tip.vue'

const { controller } = defineProps<{
  controller: AgentWorkMapSurfaceController
}>()

const {
  WORK_MAP_IN_MOTION_PAGE_SIZE,
  WORK_MAP_STATUS_PAGE_SIZE,
  addWorkMapTodo,
  armWorkMapTodoPointerDrag,
  beginWorkMapTodoDrag,
  closeWorkMapTodoComposer,
  draggedWorkMapTodoId,
  dropContentOnTodo,
  dropWorkMapThread,
  dropWorkMapTodo,
  endWorkMapDrag,
  hideTodoContentDrop,
  isWorkMapEntryVisible,
  isWorkMapProjectOpen,
  isWorkMapStatusOpen,
  modelScope,
  openBot,
  openWorkMapStatus,
  openWorkMapTodo,
  openWorkMapTodoObject,
  pressedWorkMapTodoId,
  requestArchiveWorkMapTodo,
  revealWorkMapProject,
  showMoreProjectTodos,
  showMoreProjectInMotion,
  showTodoContentDrop,
  showWorkMapProjectDrop,
  showWorkMapTodoDrop,
  startNewBot,
  submitWorkMapTodo,
  todoContentDropTargetId,
  toggleWorkMapProject,
  toggleWorkMapStatus,
  workMapBusy,
  workMap,
  workMapDropProjectId,
  workMapDropTodoStatus,
  workMapProjectPageId,
  workMapStatusIconClasses,
  workMapStatusIconNames,
  workMapStatusLabels,
  workMapInMotionActivityStatus,
  workMapTodoComposerAttachments,
  workMapTodoComposerProjectId,
  workMapTodoComposerText,
  workMapTodoGroup,
  workMapTodoStatuses,
  workMapTodoThreadStatus,
  workMapTodoTitle,
  workMapView
} = controller

function todoDictationContext(projectId: string) {
  return buildSpeechDictationContext({
    composerText: workMapTodoComposerText.value,
    projectId,
    workMap: workMap.value
  })
}

function startProjectTodo(entry: WorkMapViewEntry) {
  openWorkMapStatus(entry.project.id, 'todo')
  addWorkMapTodo(entry.project)
}

function openDirectoryBot(entry: WorkMapViewEntry) {
  if (entry.directoryBot) {
    void openBot(entry.directoryBot)
    return
  }
  void startNewBot(entry.project.id)
}
</script>

<template>
  <div class="pb-1">
    <div
      v-for="entry in workMapView.entries"
      :key="entry.project.id"
      :aria-hidden="entry.depth && !isWorkMapEntryVisible(entry) ? 'true' : undefined"
      :inert="entry.depth > 0 && !isWorkMapEntryVisible(entry)"
      :class="[
        entry.depth
          ? 'ml-3.5 grid overflow-hidden transition-[grid-template-rows,opacity] motion-reduce:transition-none'
          : '',
        entry.depth && isWorkMapEntryVisible(entry)
          ? 'grid-rows-[1fr] opacity-100 duration-300 ease-in-out'
          : entry.depth
            ? 'pointer-events-none grid-rows-[0fr] opacity-0 duration-300 ease-in-out'
            : ''
      ]"
    >
      <div :class="entry.depth ? 'min-h-0 overflow-hidden' : ''">
        <section class="relative mb-0.5">
          <div
            :data-test-id="`work-map-project-row-${entry.project.id}`"
            data-work-map-directory="bot"
            class="group/project relative flex h-11 items-center rounded-[8px] px-1 transition-colors hover:bg-hover"
            :class="workMapDropProjectId === entry.project.id ? 'bg-accent/10 text-accent' : ''"
            @dragover.stop="showWorkMapProjectDrop($event, entry.project.id)"
            @dragleave="workMapDropProjectId = undefined"
            @drop="dropWorkMapThread($event, entry.project.id)"
          >
            <Tip :label="`Open ${entry.project.name} Bot chat`">
              <button
                type="button"
                :data-test-id="`work-map-open-bot-chat-${entry.project.id}`"
                :aria-label="`Open ${entry.project.name} Bot chat`"
                class="flex min-w-0 cursor-pointer items-center rounded-[7px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-component/25"
                @click.stop="openDirectoryBot(entry)"
              >
                <span
                  :data-test-id="`work-map-bot-directory-icon-${entry.project.id}`"
                  class="flex h-10 w-7 shrink-0 items-center justify-center"
                >
                  <WorkMapBotIcon
                    :bot-id="entry.directoryBot?.id ?? entry.project.id"
                    :variant="entry.avatarVariant"
                    class="h-10 w-11"
                  />
                </span>
                <span class="ml-3 min-w-0 truncate text-[15px] font-medium text-surface">
                  {{ entry.project.name }}
                </span>
              </button>
            </Tip>
            <Tip
              :label="`${isWorkMapProjectOpen(entry.project.id) ? 'Collapse' : 'Expand'} ${entry.project.name}`"
            >
              <button
                type="button"
                :data-test-id="`work-map-project-toggle-${entry.project.id}`"
                :aria-label="`${isWorkMapProjectOpen(entry.project.id) ? 'Collapse' : 'Expand'} ${entry.project.name}`"
                :aria-expanded="isWorkMapProjectOpen(entry.project.id)"
                :aria-controls="`work-map-project-content-${entry.project.id}`"
                class="ml-0.5 flex size-6 shrink-0 items-center justify-center rounded-[5px] text-muted/65 transition-[opacity,color] hover:bg-chrome-control hover:text-surface focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-component/25 group-hover/project:opacity-100 group-focus-within/project:opacity-100"
                :class="
                  isWorkMapProjectOpen(entry.project.id)
                    ? 'opacity-100'
                    : 'pointer-events-none opacity-0 group-hover/project:pointer-events-auto group-focus-within/project:pointer-events-auto'
                "
                @click.stop="toggleWorkMapProject(entry.project.id)"
              >
                <icon-lucide-chevron-right
                  class="size-3 stroke-[1.7] transition-transform duration-200 motion-reduce:transition-none"
                  :class="isWorkMapProjectOpen(entry.project.id) ? 'rotate-90' : ''"
                />
              </button>
            </Tip>
            <span class="min-w-0 flex-1" />
            <Tip
              v-if="workMapProjectPageId(entry.project.id)"
              :label="`Reveal ${entry.project.name} on Board`"
            >
              <button
                type="button"
                :data-test-id="`work-map-reveal-project-${entry.project.id}`"
                :aria-label="`Reveal ${entry.project.name} on Board`"
                class="pointer-events-none flex size-6 items-center justify-center rounded-[5px] text-muted opacity-0 transition-opacity hover:bg-chrome-control hover:text-surface focus:pointer-events-auto focus:opacity-100 focus-visible:outline-none focus-visible:text-surface group-hover/project:pointer-events-auto group-hover/project:opacity-100 group-focus-within/project:pointer-events-auto group-focus-within/project:opacity-100"
                @click.stop="revealWorkMapProject(entry.project)"
              >
                <icon-lucide-arrow-up-right class="size-3.5 stroke-[1.7]" />
              </button>
            </Tip>
          </div>

          <Transition
            enter-active-class="grid overflow-hidden transition-[grid-template-rows,opacity] duration-300 ease-in-out motion-reduce:transition-none"
            enter-from-class="grid-rows-[0fr] opacity-0"
            enter-to-class="grid-rows-[1fr] opacity-100"
            leave-active-class="grid overflow-hidden transition-[grid-template-rows,opacity] duration-300 ease-in-out motion-reduce:transition-none"
            leave-from-class="grid-rows-[1fr] opacity-100"
            leave-to-class="grid-rows-[0fr] opacity-0"
          >
            <div
              v-if="isWorkMapProjectOpen(entry.project.id)"
              :id="`work-map-project-content-${entry.project.id}`"
              :data-test-id="`work-map-project-content-${entry.project.id}`"
              class="ml-2"
            >
              <div class="min-h-0 overflow-hidden">
                <div class="pt-0.5 pb-1">
                  <WorkMapScheduledSection
                    :bots="entry.bots"
                    :controller="controller"
                    :directory-id="entry.project.id"
                    :schedule-bot="entry.directoryBot"
                  />
                  <section
                    v-for="status in workMapTodoStatuses"
                    :key="status"
                    class="relative mb-0.5"
                    @dragover.stop="showWorkMapTodoDrop($event, entry.project.id, status)"
                    @dragleave="workMapDropTodoStatus = null"
                    @drop="dropWorkMapTodo($event, entry.project.id, status)"
                  >
                    <div
                      role="button"
                      tabindex="0"
                      :data-test-id="`work-map-status-toggle-${entry.project.id}-${status}`"
                      :aria-expanded="isWorkMapStatusOpen(entry.project.id, status)"
                      :aria-label="`${isWorkMapStatusOpen(entry.project.id, status) ? 'Collapse' : 'Expand'} ${workMapStatusLabels[status]}`"
                      class="group/status flex h-8 cursor-pointer items-center gap-2 rounded-[6px] px-2 text-[13px] font-medium text-surface transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-component/35"
                      :class="
                        workMapDropTodoStatus === `${entry.project.id}:${status}`
                          ? 'bg-accent/10 text-accent'
                          : ''
                      "
                      @click="toggleWorkMapStatus(entry.project.id, status)"
                      @keydown.enter.prevent="toggleWorkMapStatus(entry.project.id, status)"
                      @keydown.space.prevent="toggleWorkMapStatus(entry.project.id, status)"
                    >
                      <span class="relative z-10 flex h-8 w-6 shrink-0 items-center justify-center">
                        <IconlyIcon
                          :name="workMapStatusIconNames[status]"
                          class="size-[16px]"
                          :class="workMapStatusIconClasses[status]"
                        />
                      </span>
                      <span>{{ workMapStatusLabels[status] }}</span>
                      <span class="min-w-0 flex-1" />
                      <AgentThreadStatusIndicator
                        v-if="status === 'in_motion' && workMapInMotionActivityStatus(entry)"
                        :status="workMapInMotionActivityStatus(entry)"
                      />
                      <Tip v-if="status === 'todo'" label="Add todo">
                        <button
                          type="button"
                          :data-test-id="`work-map-add-todo-${entry.project.id}`"
                          aria-label="Add todo"
                          class="flex size-6 items-center justify-center text-muted opacity-0 transition-opacity hover:text-surface focus:opacity-100 focus-visible:outline-none focus-visible:text-surface group-hover/status:opacity-100"
                          @click.stop="startProjectTodo(entry)"
                        >
                          <IconlyIcon name="plus" class="size-4 stroke-[1.7]" />
                        </button>
                      </Tip>
                    </div>
                    <div
                      v-show="isWorkMapStatusOpen(entry.project.id, status)"
                      :data-test-id="`work-map-status-content-${entry.project.id}-${status}`"
                    >
                      <WorkMapProjectChats
                        v-if="status === 'in_motion'"
                        :controller="controller"
                        :entry="entry"
                      />
                      <div
                        v-if="
                          status === 'todo' && workMapTodoComposerProjectId === entry.project.id
                        "
                        :data-test-id="`work-map-todo-composer-${entry.project.id}`"
                        class="relative z-20 mr-2 mb-1 ml-8"
                        @keydown.esc.stop="closeWorkMapTodoComposer"
                      >
                        <AiPromptInput
                          v-model="workMapTodoComposerText"
                          v-model:attachments="workMapTodoComposerAttachments"
                          compact
                          :dictation-context="todoDictationContext(entry.project.id)"
                          :disabled="workMapBusy"
                          label="New todo"
                          placeholder="Save something for later…"
                          send-label="Add todo"
                          :scope="modelScope"
                          @send="submitWorkMapTodo"
                        />
                      </div>
                      <div
                        v-for="(todo, todoIndex) in workMapTodoGroup(entry, status).items"
                        :key="todo.id"
                        draggable="true"
                        :data-test-id="`work-map-todo-${todo.id}`"
                        class="group/todo relative z-10 ml-8 flex min-h-8 cursor-pointer items-center rounded-[7px] pr-2 pl-2 text-left text-[12.5px] text-surface before:pointer-events-none before:absolute before:top-2.5 before:-left-3 before:h-1.5 before:w-3 before:rounded-bl-[6px] before:border-b before:border-l before:border-work-map-tree before:content-[''] after:pointer-events-none after:absolute after:top-0 after:-left-3 after:border-l after:border-work-map-tree after:content-[''] hover:bg-hover"
                        :class="[
                          todoIndex === workMapTodoGroup(entry, status).items.length - 1 &&
                          !workMapTodoGroup(entry, status).remaining
                            ? 'after:h-2.5'
                            : 'after:h-full',
                          todoContentDropTargetId === todo.id
                            ? 'bg-accent/10 ring-1 ring-inset ring-accent/40'
                            : pressedWorkMapTodoId === todo.id || draggedWorkMapTodoId === todo.id
                              ? '!cursor-grabbing'
                              : ''
                        ]"
                        :title="
                          todo.description ||
                          'Open chat; drop content here or drag the row to change status'
                        "
                        :aria-label="`Open Todo chat: ${workMapTodoTitle(todo)}`"
                        @pointerdown="armWorkMapTodoPointerDrag(todo)"
                        @dragstart="beginWorkMapTodoDrag($event, todo)"
                        @dragend="endWorkMapDrag"
                        @dragenter="showTodoContentDrop($event, todo)"
                        @dragover="showTodoContentDrop($event, todo)"
                        @dragleave="hideTodoContentDrop($event, todo)"
                        @drop="dropContentOnTodo($event, todo)"
                        @click="openWorkMapTodo(todo)"
                        @keydown.enter.prevent="openWorkMapTodo(todo)"
                        role="button"
                        tabindex="0"
                      >
                        <span class="min-w-0 flex-1 truncate">{{ workMapTodoTitle(todo) }}</span>
                        <Tip label="Archive chat">
                          <button
                            type="button"
                            draggable="false"
                            :data-test-id="`work-map-archive-todo-${todo.id}`"
                            aria-label="Archive chat"
                            class="pointer-events-none flex size-5 shrink-0 items-center justify-center rounded-[5px] text-muted opacity-0 hover:bg-chrome-control hover:text-surface focus:pointer-events-auto focus:opacity-100 focus-visible:outline-none focus-visible:text-surface group-hover/todo:pointer-events-auto group-hover/todo:opacity-100 group-focus-within/todo:pointer-events-auto group-focus-within/todo:opacity-100"
                            @pointerdown.stop
                            @click.stop="requestArchiveWorkMapTodo(todo)"
                          >
                            <icon-lucide-archive class="size-4 stroke-[1.6]" />
                          </button>
                        </Tip>
                        <Tip label="Open Todo object">
                          <button
                            type="button"
                            draggable="false"
                            :data-test-id="`work-map-open-todo-object-${todo.id}`"
                            aria-label="Open Todo object"
                            class="pointer-events-none flex size-5 shrink-0 items-center justify-center rounded-[5px] text-muted opacity-0 transition-opacity hover:bg-chrome-control hover:text-surface focus:pointer-events-auto focus:opacity-100 focus-visible:outline-none focus-visible:text-surface group-hover/todo:pointer-events-auto group-hover/todo:opacity-100 group-focus-within/todo:pointer-events-auto group-focus-within/todo:opacity-100"
                            @pointerdown.stop
                            @click.stop="openWorkMapTodoObject(todo)"
                          >
                            <IconlyIcon name="document" class="size-4 stroke-[1.6]" />
                          </button>
                        </Tip>
                        <AgentThreadStatusIndicator
                          v-if="workMapTodoThreadStatus(todo)"
                          :status="workMapTodoThreadStatus(todo)"
                        />
                      </div>
                      <button
                        v-if="status === 'todo' && workMapTodoGroup(entry, status).remaining"
                        type="button"
                        :data-test-id="`work-map-show-more-${entry.project.id}-${status}`"
                        :aria-label="`Show ${Math.min(WORK_MAP_STATUS_PAGE_SIZE, workMapTodoGroup(entry, status).remaining)} more ${workMapStatusLabels[status].toLowerCase()} tasks`"
                        class="relative z-10 ml-8 flex h-7 items-center rounded-[7px] px-2 text-left text-[12px] text-muted/70 transition-colors before:pointer-events-none before:absolute before:top-2 before:-left-3 before:h-1.5 before:w-3 before:rounded-bl-[6px] before:border-b before:border-l before:border-work-map-tree before:content-[''] after:pointer-events-none after:absolute after:top-0 after:-left-3 after:h-2 after:border-l after:border-work-map-tree after:content-[''] hover:!text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-component/35"
                        @click.stop="showMoreProjectTodos(entry.project.id, status)"
                      >
                        Show more
                      </button>
                      <button
                        v-if="status === 'in_motion' && entry.inMotion.remaining"
                        type="button"
                        :data-test-id="`work-map-show-more-in-motion-${entry.project.id}`"
                        :aria-label="`Show ${Math.min(WORK_MAP_IN_MOTION_PAGE_SIZE, entry.inMotion.remaining)} more in motion`"
                        class="relative z-10 ml-8 flex h-7 items-center rounded-[7px] px-2 text-left text-[12px] text-muted/70 transition-colors before:pointer-events-none before:absolute before:top-2 before:-left-3 before:h-1.5 before:w-3 before:rounded-bl-[6px] before:border-b before:border-l before:border-work-map-tree before:content-[''] after:pointer-events-none after:absolute after:top-0 after:-left-3 after:h-2 after:border-l after:border-work-map-tree after:content-[''] hover:!text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-component/35"
                        @click.stop="showMoreProjectInMotion(entry.project.id)"
                      >
                        Show more
                      </button>
                      <div
                        v-if="
                          status === 'in_motion'
                            ? !entry.inMotion.total
                            : !workMapTodoGroup(entry, status).total
                        "
                        :data-test-id="`work-map-empty-${entry.project.id}-${status}`"
                        class="relative z-10 ml-8 flex h-7 items-center pr-2 pl-2 text-[12px] text-muted/55 before:pointer-events-none before:absolute before:top-2 before:-left-3 before:h-1.5 before:w-3 before:rounded-bl-[6px] before:border-b before:border-l before:border-work-map-tree before:content-[''] after:pointer-events-none after:absolute after:top-0 after:-left-3 after:h-2 after:border-l after:border-work-map-tree after:content-['']"
                      >
                        {{ status === 'in_motion' ? 'No working chats' : 'No todos' }}
                      </div>
                    </div>
                  </section>
                </div>
              </div>
            </div>
          </Transition>
        </section>
      </div>
    </div>
  </div>
</template>
