import htm from 'htm';
import { h, render } from 'preact';
import { IndexeddbPersistence } from 'y-indexeddb';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import './style.css';
import {
    createTaskId,
    createYTask,
    extractAttributes,
    parseTodoLine,
    parseTodoText,
    readYTask,
    replaceYArrayValues,
    replaceYTasks,
    sortTasks,
    serializeTodoLine,
    stripAttributesFromText,
    stripTagsFromText
} from './todoModel.js';

const html = htm.bind(h);
const doc = new Y.Doc();
const todoList = doc.getArray('todoItems');
const localPersistence = new IndexeddbPersistence('todo-crdt-storage', doc);
const settingsKey = 'todo-crdt-sync-settings';
const savedFiltersKey = 'todo-crdt-saved-filters';

let localReady = false;
let localError = '';
let connectionStatus = 'disconnected';
let remoteSyncStatus = '';
let settingsError = '';
let importError = '';
let importStatus = '';
let importMode = 'append';
let pendingReplaceTasks = null;
let pendingReplaceFilename = '';
let pendingDeleteTask = null;
let wsProvider = null;
let wsUrl = '';
let roomName = 'todo-crdt-room';
let newTaskInput = '';
let searchQuery = '';
let selectedProject = '';
let selectedContext = '';
let savedFilters = [];
let activeSavedFilterId = '';
let showFilterForm = false;
let newFilterName = '';
let newFilterProject = '';
let newFilterContext = '';
let filterError = '';
let showSettings = false;
let editingTaskId = null;
let editingTaskText = '';
let editingTaskPriority = '';
let editingTaskDueDate = '';
let editingProjects = [];
let editingContexts = [];
let projectInput = '';
let contextInput = '';

try {
    const savedSettings = JSON.parse(localStorage.getItem(settingsKey) || '{}');
    wsUrl = typeof savedSettings.url === 'string' ? savedSettings.url : '';
    roomName =
        typeof savedSettings.room === 'string' && savedSettings.room
            ? savedSettings.room
            : roomName;
} catch (error) {
    settingsError = `Could not read sync settings: ${error.message}`;
}

try {
    const storedFilters = JSON.parse(localStorage.getItem(savedFiltersKey) || '[]');
    if (Array.isArray(storedFilters)) {
        savedFilters = storedFilters.filter(
            (filter) =>
                filter &&
                typeof filter.id === 'string' &&
                typeof filter.name === 'string' &&
                typeof filter.project === 'string' &&
                typeof filter.context === 'string'
        );
    }
} catch (error) {
    filterError = `Could not read saved filters: ${error.message}`;
}

todoList.observeDeep(() => {
    ensureTaskMetadata();
    renderApp();
});

localPersistence.whenSynced
    .then(() => {
        localReady = true;
        renderApp();
    })
    .catch((error) => {
        localError = `Browser storage is unavailable: ${error.message}`;
        renderApp();
    });

function localDate() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
}

function getTasks() {
    return todoList.toArray().map((yTask) => ({ ...readYTask(yTask), yTask }));
}

function getFilteredTasks(tasks) {
    const query = searchQuery.trim().toLowerCase();
    return tasks.filter((task) => {
        if (selectedProject && !task.projects.includes(selectedProject)) return false;
        if (selectedContext && !task.contexts.includes(selectedContext)) return false;
        if (!query) return true;
        return [task.text, ...task.projects, ...task.contexts].some((value) =>
            value.toLowerCase().includes(query)
        );
    });
}

function getVisibleTasks(tasks) {
    return sortTasks(getFilteredTasks(tasks));
}

function getDueDateState(task) {
    const dueDate = task.attributes.due;
    if (!dueDate || task.completed) return null;
    if (dueDate < localDate()) return 'overdue';
    if (dueDate === localDate()) return 'today';
    return 'upcoming';
}

function ensureTaskMetadata() {
    doc.transact(() => {
        for (const task of todoList.toArray()) {
            if (!task.get('creationDate')) task.set('creationDate', localDate());
            if (task.get('completed') && !task.get('completionDate')) {
                task.set('completionDate', localDate());
            }

            let attributes = task.get('attributes');
            if (!(attributes instanceof Y.Map)) {
                attributes = new Y.Map();
                task.set('attributes', attributes);
            }
            const yText = task.get('text');
            const text = yText.toString();
            const discoveredAttributes = extractAttributes(text);
            for (const [key, value] of Object.entries(discoveredAttributes)) {
                if (attributes.get(key) !== value) attributes.set(key, value);
            }
            const cleanText = stripAttributesFromText(text);
            if (cleanText !== text) {
                yText.delete(0, yText.length);
                if (cleanText) yText.insert(0, cleanText);
            }
        }
    });
}

function saveFilters() {
    try {
        localStorage.setItem(savedFiltersKey, JSON.stringify(savedFilters));
        filterError = '';
        return true;
    } catch (error) {
        filterError = `Could not save filters: ${error.message}`;
        return false;
    }
}

function addSavedFilter(event) {
    event.preventDefault();
    const name = newFilterName.trim();
    if (!name) {
        filterError = 'Enter a name for this filter.';
        renderApp();
        return;
    }
    if (!newFilterProject && !newFilterContext) {
        filterError = 'Choose a project, a context, or both for this filter.';
        renderApp();
        return;
    }
    if (savedFilters.some((filter) => filter.name.toLowerCase() === name.toLowerCase())) {
        filterError = 'A saved filter already uses that name.';
        renderApp();
        return;
    }

    const filter = {
        id: createTaskId(),
        name,
        project: newFilterProject,
        context: newFilterContext
    };
    const previousFilters = savedFilters;
    savedFilters = [...savedFilters, filter];
    if (saveFilters()) {
        activeSavedFilterId = filter.id;
        selectedProject = filter.project;
        selectedContext = filter.context;
        searchQuery = '';
        showFilterForm = false;
        newFilterName = '';
    } else {
        savedFilters = previousFilters;
    }
    renderApp();
}

function toggleSavedFilter(filter) {
    if (activeSavedFilterId === filter.id) {
        activeSavedFilterId = '';
        selectedProject = '';
        selectedContext = '';
    } else {
        activeSavedFilterId = filter.id;
        selectedProject = filter.project;
        selectedContext = filter.context;
    }
    renderApp();
}

function deleteSavedFilter(event, id) {
    event.stopPropagation();
    const previousFilters = savedFilters;
    savedFilters = savedFilters.filter((filter) => filter.id !== id);
    if (!saveFilters()) {
        savedFilters = previousFilters;
        renderApp();
        return;
    }
    if (activeSavedFilterId === id) {
        activeSavedFilterId = '';
        selectedProject = '';
        selectedContext = '';
    }
    renderApp();
}

function addTask(event) {
    event?.preventDefault();
    const parsed = parseTodoLine(newTaskInput);
    if (!parsed?.text) return;
    if (!parsed.creationDate) parsed.creationDate = localDate();

    createYTask(parsed, doc, todoList);
    newTaskInput = '';
    renderApp();
    document.getElementById('new-task')?.focus();
}

function toggleTask(task) {
    doc.transact(() => {
        const completed = !task.get('completed');
        task.set('completed', completed);
        task.set('completionDate', completed ? localDate() : null);
    });
}

function requestDeleteTask(task) {
    pendingDeleteTask = {
        yTask: task,
        text: stripTagsFromText(task.get('text').toString())
    };
    renderApp();
}

function confirmDeleteTask() {
    if (!pendingDeleteTask) return;
    const index = todoList.toArray().indexOf(pendingDeleteTask.yTask);
    if (index >= 0) doc.transact(() => todoList.delete(index, 1));
    pendingDeleteTask = null;
    renderApp();
}

function cancelDeleteTask() {
    pendingDeleteTask = null;
    renderApp();
}

function confirmReplaceTasks() {
    if (!pendingReplaceTasks) return;
    const count = pendingReplaceTasks.length;
    replaceYTasks(pendingReplaceTasks, doc, todoList);
    importStatus = `Replaced the task list with ${count} imported task${count === 1 ? '' : 's'}.`;
    importError = '';
    pendingReplaceTasks = null;
    pendingReplaceFilename = '';
    renderApp();
}

function cancelReplaceTasks() {
    pendingReplaceTasks = null;
    pendingReplaceFilename = '';
    renderApp();
}

function startEditing(task) {
    const item = readYTask(task);
    editingTaskId = item.id;
    editingTaskText = stripTagsFromText(stripAttributesFromText(item.text));
    editingTaskPriority = item.priority || '';
    editingTaskDueDate = item.attributes.due || '';
    editingProjects = [...item.projects];
    editingContexts = [...item.contexts];
    projectInput = '';
    contextInput = '';
    renderApp();
    document.querySelector('.task-edit')?.focus();
}

function addEditTag(kind) {
    const input = kind === 'project' ? projectInput : contextInput;
    const tags = kind === 'project' ? editingProjects : editingContexts;
    const value = input.trim().replace(/^[+@]/, '');
    if (!value || /\s/.test(value)) return;
    const updated = [...new Set([...tags, value])];
    if (kind === 'project') {
        editingProjects = updated;
        projectInput = '';
    } else {
        editingContexts = updated;
        contextInput = '';
    }
    renderApp();
    document.querySelector(kind === 'project' ? '#project-picker' : '#context-picker')?.focus();
}

function removeEditTag(kind, value) {
    if (kind === 'project') {
        editingProjects = editingProjects.filter((item) => item !== value);
    } else {
        editingContexts = editingContexts.filter((item) => item !== value);
    }
    renderApp();
}

function saveEdit(task) {
    const text = editingTaskText.trim();
    const attributes = { ...readYTask(task).attributes };
    if (editingTaskDueDate) attributes.due = editingTaskDueDate;
    else delete attributes.due;
    const sharedText = [
        text,
        ...editingProjects.map((project) => `+${project}`),
        ...editingContexts.map((context) => `@${context}`),
        ...Object.entries(attributes).map(([key, value]) => `${key}:${value}`)
    ].filter(Boolean).join(' ');

    doc.transact(() => {
        const yText = task.get('text');
        if (yText.length) yText.delete(0, yText.length);
        if (sharedText) yText.insert(0, sharedText);
        replaceYArrayValues(task.get('projects'), editingProjects);
        replaceYArrayValues(task.get('contexts'), editingContexts);
        task.set('priority', editingTaskPriority || null);
        let yAttributes = task.get('attributes');
        if (!(yAttributes instanceof Y.Map)) {
            yAttributes = new Y.Map();
            task.set('attributes', yAttributes);
        }
        for (const key of [...yAttributes.keys()]) {
            if (!(key in attributes)) yAttributes.delete(key);
        }
        for (const [key, value] of Object.entries(attributes)) {
            yAttributes.set(key, value);
        }
    });
    editingTaskId = null;
    editingTaskText = '';
    editingProjects = [];
    editingContexts = [];
    renderApp();
}

function cancelEditing() {
    editingTaskId = null;
    editingTaskText = '';
    editingProjects = [];
    editingContexts = [];
    renderApp();
}

function saveSyncSettings() {
    settingsError = '';
    try {
        localStorage.setItem(
            settingsKey,
            JSON.stringify({ url: wsUrl.trim(), room: roomName.trim() })
        );
    } catch (error) {
        settingsError = `Could not save sync settings: ${error.message}`;
    }
    renderApp();
}

function connectWebSocket() {
    const url = wsUrl.trim();
    const room = roomName.trim();
    let parsedUrl;
    try {
        parsedUrl = new URL(url);
    } catch {
        settingsError = 'Enter a valid WebSocket URL.';
        renderApp();
        return;
    }
    if (!['ws:', 'wss:'].includes(parsedUrl.protocol) || !room) {
        settingsError = 'Use a ws:// or wss:// URL and provide a room name.';
        renderApp();
        return;
    }

    saveSyncSettings();
    if (wsProvider) wsProvider.destroy();
    connectionStatus = 'connecting';
    remoteSyncStatus = '';
    try {
        wsProvider = new WebsocketProvider(url, room, doc);
        wsProvider.on('status', ({ status }) => {
            connectionStatus = status;
            renderApp();
        });
        wsProvider.on('sync', (synced) => {
            remoteSyncStatus = synced ? 'up to date' : 'exchanging changes';
            renderApp();
        });
        wsProvider.on('connection-error', () => {
            connectionStatus = 'error';
            settingsError =
                'Could not connect to the sync server. Check the URL and server availability.';
            renderApp();
        });
        wsProvider.on('connection-close', () => {
            if (connectionStatus !== 'error') connectionStatus = 'disconnected';
            renderApp();
        });
    } catch (error) {
        connectionStatus = 'error';
        settingsError = `Could not start sync: ${error.message}`;
        renderApp();
    }
    renderApp();
}

function disconnectWebSocket() {
    if (wsProvider) wsProvider.destroy();
    wsProvider = null;
    connectionStatus = 'disconnected';
    remoteSyncStatus = '';
    renderApp();
}

async function importTodoFile(event) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    importError = '';
    importStatus = '';
    try {
        const tasks = parseTodoText(await file.text());
        if (!tasks.length) {
            if (importMode === 'replace') {
                pendingReplaceTasks = [];
                pendingReplaceFilename = file.name;
            } else {
                importError = 'The selected file contains no importable tasks.';
            }
        } else if (importMode === 'replace') {
            pendingReplaceTasks = tasks;
            pendingReplaceFilename = file.name;
        } else {
            doc.transact(() => {
                tasks.forEach((task) => createYTask(task, doc, todoList));
            });
            importStatus = `Imported ${tasks.length} task${tasks.length === 1 ? '' : 's'}.`;
        }
    } catch (error) {
        importError = `Could not import the selected file: ${error.message}`;
    }
    importMode = 'append';
    renderApp();
}

function chooseImportFile(mode) {
    importMode = mode;
    document.getElementById('todo-file')?.click();
}

function exportTodoFile() {
    const contents = todoList
        .toArray()
        .map((task) => serializeTodoLine(readYTask(task)))
        .join('\n');
    const blob = new Blob([contents ? `${contents}\n` : ''], {
        type: 'text/plain;charset=utf-8'
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'todo.txt';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
}

function TodoApp() {
    const tasks = getTasks();
    const projects = [...new Set(tasks.flatMap((task) => task.projects))].sort();
    const contexts = [...new Set(tasks.flatMap((task) => task.contexts))].sort();
    const visibleTasks = getVisibleTasks(tasks);

    return html`
        <main class="todo-app">
            <header class="app-header">
                <div>
                    <h1>To Do</h1>
                    <p>Local-first tasks with optional CRDT sync</p>
                </div>
                <button class="secondary" type="button" onClick=${() => {
                    showSettings = true;
                    renderApp();
                }}>
                    Settings
                </button>
            </header>

            <p class="storage-status" role="status">
                ${localError || (localReady ? 'Saved in this browser' : 'Loading browser storage…')}
                ${connectionStatus !== 'disconnected' ? html`<span> · Sync ${connectionStatus}${remoteSyncStatus ? ` — ${remoteSyncStatus}` : ''}</span>` : ''}
                ${settingsError ? html`<span class="error"> · ${settingsError}</span>` : ''}
                ${importStatus ? html`<span> · ${importStatus}</span>` : ''}
                ${importError ? html`<span class="error"> · ${importError}</span>` : ''}
            </p>

            <form class="add-form" onSubmit=${addTask}>
                <input
                    id="new-task"
                    type="text"
                    value=${newTaskInput}
                    onInput=${(event) => {
                        newTaskInput = event.currentTarget.value;
                    }}
                    placeholder="Add a task, +project, or @context"
                    aria-label="New task"
                />
                <button type="submit">Add task</button>
            </form>

            <section class="filters" aria-label="Task filters">
                <input
                    type="search"
                    value=${searchQuery}
                    onInput=${(event) => {
                        searchQuery = event.currentTarget.value;
                        renderApp();
                    }}
                    placeholder="Search tasks"
                    aria-label="Search tasks"
                />
                <select value=${selectedProject} onChange=${(event) => {
                    selectedProject = event.currentTarget.value;
                    activeSavedFilterId = '';
                    renderApp();
                }} aria-label="Filter by project">
                    <option value="">All projects</option>
                    ${projects.map((project) => html`<option value=${project}>+${project}</option>`)}
                </select>
                <select value=${selectedContext} onChange=${(event) => {
                    selectedContext = event.currentTarget.value;
                    activeSavedFilterId = '';
                    renderApp();
                }} aria-label="Filter by context">
                    <option value="">All contexts</option>
                    ${contexts.map((context) => html`<option value=${context}>@${context}</option>`)}
                </select>
            </section>

            <section class="filter-tools" aria-label="Saved filters and sorting">
                <span class="sort-order" aria-label="Tasks sorted by completion, priority, due date, creation date, and name">
                    Sorted: open first · priority · due · created · name
                </span>
                <button class="secondary" type="button" onClick=${() => {
                    showFilterForm = !showFilterForm;
                    newFilterProject = selectedProject;
                    newFilterContext = selectedContext;
                    filterError = '';
                    renderApp();
                }}>
                    Save filter
                </button>
            </section>

            ${
                savedFilters.length
                    ? html`<div class="filter-chips" role="group" aria-label="Saved filters">
                        ${savedFilters.map(
                            (filter) => html`<div class=${activeSavedFilterId === filter.id ? 'filter-chip-wrap active' : 'filter-chip-wrap'}>
                                <button
                                    class=${activeSavedFilterId === filter.id ? 'filter-chip active' : 'filter-chip'}
                                    type="button"
                                    aria-pressed=${activeSavedFilterId === filter.id}
                                    onClick=${() => toggleSavedFilter(filter)}
                                >
                                    <span>${filter.name}</span>
                                    <span class="chip-description">${[
                                        filter.project && `+${filter.project}`,
                                        filter.context && `@${filter.context}`
                                    ].filter(Boolean).join(' ')}</span>
                                </button>
                                <button
                                    class="chip-remove"
                                    type="button"
                                    aria-label="Delete ${filter.name} filter"
                                    onClick=${(event) => deleteSavedFilter(event, filter.id)}
                                >×</button>
                            </div>`
                        )}
                    </div>`
                    : ''
            }

            ${
                showFilterForm
                    ? html`<form class="filter-form" onSubmit=${addSavedFilter}>
                        <label>
                            Filter name
                            <input
                                type="text"
                                value=${newFilterName}
                                onInput=${(event) => {
                                    newFilterName = event.currentTarget.value;
                                }}
                                placeholder="Chores at home"
                                required
                            />
                        </label>
                        <label>
                            Project
                            <select value=${newFilterProject} onChange=${(event) => {
                                newFilterProject = event.currentTarget.value;
                            }}>
                                <option value="">Any project</option>
                                ${projects.map((project) => html`<option value=${project}>+${project}</option>`)}
                            </select>
                        </label>
                        <label>
                            Context
                            <select value=${newFilterContext} onChange=${(event) => {
                                newFilterContext = event.currentTarget.value;
                            }}>
                                <option value="">Any context</option>
                                ${contexts.map((context) => html`<option value=${context}>@${context}</option>`)}
                            </select>
                        </label>
                        <button type="submit">Create filter</button>
                        <button class="secondary" type="button" onClick=${() => {
                            showFilterForm = false;
                            filterError = '';
                            renderApp();
                        }}>Cancel</button>
                    </form>`
                    : ''
            }
            ${filterError ? html`<p class="error" role="alert">${filterError}</p>` : ''}

            ${
                visibleTasks.length
                    ? html`                    <ul class="task-list">
                        ${visibleTasks.map(
                            (item) => html`
                            <li class=${item.completed ? 'task completed' : 'task'}>
                                <input
                                    type="checkbox"
                                    checked=${item.completed}
                                    onChange=${() => toggleTask(item.yTask)}
                                    aria-label="Mark ${stripTagsFromText(item.text)} complete"
                                />
                                <button
                                    class="task-open"
                                    type="button"
                                    onClick=${() => startEditing(item.yTask)}
                                    aria-label="Edit ${stripTagsFromText(item.text)}"
                                >
                                    <span class="task-main">
                                        <span class="task-text">${stripTagsFromText(stripAttributesFromText(item.text))}</span>
                                        <span class="task-tags">
                                            ${item.projects.map((project) => html`<span class="tag project-tag">+${project}</span>`)}
                                            ${item.contexts.map((context) => html`<span class="tag context-tag">@${context}</span>`)}
                                            ${Object.entries(item.attributes)
                                                .filter(([key]) => key !== 'due')
                                                .map(([key, value]) => html`<span class="tag attribute-tag">${key}:${value}</span>`)}
                                        </span>
                                    </span>
                                    ${item.priority
                                        ? html`<span class="priority-badge priority-${item.priority}">(${item.priority})</span>`
                                        : ''}
                                    ${item.attributes.due
                                        ? html`<span class="due-badge due-${getDueDateState(item) || 'done'}">${getDueDateState(item) === 'overdue' ? 'Overdue · ' : ''}${getDueDateState(item) === 'today' ? 'Due today · ' : ''}${item.attributes.due}</span>`
                                        : ''}
                                </button>
                                <button class="delete" type="button" onClick=${() => requestDeleteTask(item.yTask)} aria-label="Delete ${item.text}">Delete</button>
                            </li>
                        `
                    )}
                </ul>`
                    : html`<p class="empty-state">${tasks.length ? 'No tasks match these filters.' : 'No tasks yet. Add one above to get started.'}</p>`
            }

            ${
                editingTaskId
                    ? (() => {
                        const task = tasks.find((item) => item.id === editingTaskId);
                        if (!task) return '';
                        const knownProjects = [...new Set([...projects, ...editingProjects])].sort();
                        const knownContexts = [...new Set([...contexts, ...editingContexts])].sort();
                        return html`
                            <div class="modal-backdrop" onClick=${(event) => {
                                if (event.target === event.currentTarget) cancelEditing();
                            }}>
                                <form class="task-editor" role="dialog" aria-modal="true" aria-labelledby="task-editor-title" onSubmit=${(event) => {
                                    event.preventDefault();
                                    saveEdit(task.yTask);
                                }} onKeyDown=${(event) => {
                                    if (event.key === 'Escape') cancelEditing();
                                }}>
                                    <h2 id="task-editor-title">Edit task</h2>
                                    <label class="editor-field">
                                        Task
                                        <textarea
                                            class="task-edit"
                                            value=${editingTaskText}
                                            onInput=${(event) => {
                                                editingTaskText = event.currentTarget.value;
                                            }}
                                            rows="3"
                                            required
                                        ></textarea>
                                    </label>
                                    <div class="editor-grid">
                                        <label class="editor-field">
                                            Priority
                                            <select value=${editingTaskPriority} onChange=${(event) => {
                                                editingTaskPriority = event.currentTarget.value;
                                            }}>
                                                <option value="">No priority</option>
                                                ${'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((priority) => html`<option value=${priority}>(${priority})</option>`)}
                                            </select>
                                        </label>
                                        <label class="editor-field">
                                            Due date
                                            <input
                                                type="date"
                                                value=${editingTaskDueDate}
                                                onInput=${(event) => {
                                                    editingTaskDueDate = event.currentTarget.value;
                                                }}
                                            />
                                        </label>
                                    </div>
                                    <fieldset class="tag-editor">
                                        <legend>Projects</legend>
                                        <div class="selected-tags">
                                            ${editingProjects.map((project) => html`<span class="selected-tag project-tag">
                                                +${project}
                                                <button type="button" aria-label="Remove project ${project}" onClick=${() => removeEditTag('project', project)}>×</button>
                                            </span>`)}
                                        </div>
                                        <div class="tag-adder">
                                            <input
                                                id="project-picker"
                                                type="text"
                                                list="known-projects"
                                                value=${projectInput}
                                                placeholder="Choose or type a project"
                                                onInput=${(event) => {
                                                    projectInput = event.currentTarget.value;
                                                }}
                                                onKeyDown=${(event) => {
                                                    if (event.key === 'Enter') {
                                                        event.preventDefault();
                                                        addEditTag('project');
                                                    }
                                                }}
                                            />
                                            <datalist id="known-projects">
                                                ${knownProjects.map((project) => html`<option value=${project} />`)}
                                            </datalist>
                                            <button class="secondary" type="button" onClick=${() => addEditTag('project')}>Add project</button>
                                        </div>
                                    </fieldset>
                                    <fieldset class="tag-editor">
                                        <legend>Contexts</legend>
                                        <div class="selected-tags">
                                            ${editingContexts.map((context) => html`<span class="selected-tag context-tag">
                                                @${context}
                                                <button type="button" aria-label="Remove context ${context}" onClick=${() => removeEditTag('context', context)}>×</button>
                                            </span>`)}
                                        </div>
                                        <div class="tag-adder">
                                            <input
                                                id="context-picker"
                                                type="text"
                                                list="known-contexts"
                                                value=${contextInput}
                                                placeholder="Choose or type a context"
                                                onInput=${(event) => {
                                                    contextInput = event.currentTarget.value;
                                                }}
                                                onKeyDown=${(event) => {
                                                    if (event.key === 'Enter') {
                                                        event.preventDefault();
                                                        addEditTag('context');
                                                    }
                                                }}
                                            />
                                            <datalist id="known-contexts">
                                                ${knownContexts.map((context) => html`<option value=${context} />`)}
                                            </datalist>
                                            <button class="secondary" type="button" onClick=${() => addEditTag('context')}>Add context</button>
                                        </div>
                                    </fieldset>
                                    <div class="editor-actions">
                                        <button type="submit">Save changes</button>
                                        <button class="secondary" type="button" onClick=${cancelEditing}>Cancel</button>
                                    </div>
                                </form>
                            </div>
                        `;
                    })()
                    : ''
            }

            ${
                showSettings
                    ? html`
                <div class="modal-backdrop" onClick=${(event) => {
                    if (event.target === event.currentTarget) {
                        showSettings = false;
                        renderApp();
                    }
                }}>
                    <section class="settings" role="dialog" aria-modal="true" aria-labelledby="settings-title">
                        <h2 id="settings-title">Settings</h2>
                        <section class="settings-section" aria-labelledby="file-settings-title">
                            <h3 id="file-settings-title">Todo.txt files</h3>
                            <p>Import and export files in todo.txt format. Import adds tasks to your current list; replacing the list asks for confirmation.</p>
                            <input
                                id="todo-file"
                                class="visually-hidden"
                                type="file"
                                accept=".txt,text/plain"
                                onChange=${importTodoFile}
                                aria-label="Choose a todo.txt file"
                            />
                            <div class="settings-actions">
                                <button type="button" onClick=${() => chooseImportFile('append')}>Import and add</button>
                                <button class="delete" type="button" onClick=${() => chooseImportFile('replace')}>Replace current tasks…</button>
                                <button class="secondary" type="button" onClick=${exportTodoFile}>Export todo.txt</button>
                            </div>
                            ${importStatus ? html`<p role="status">${importStatus}</p>` : ''}
                            ${importError ? html`<p class="error" role="alert">${importError}</p>` : ''}
                        </section>
                        <section aria-labelledby="sync-settings-title">
                            <h3 id="sync-settings-title">Sync settings</h3>
                            <p>Your tasks are stored on this device without any sync configuration. Connect a Yjs WebSocket server only if you want to share this document across devices.</p>
                            <label>
                                WebSocket URL
                                <input type="text" value=${wsUrl} onInput=${(event) => {
                                    wsUrl = event.currentTarget.value;
                                }} placeholder="ws://localhost:1234" />
                            </label>
                            <label>
                                Shared room name
                                <input type="text" value=${roomName} onInput=${(event) => {
                                    roomName = event.currentTarget.value;
                                }} />
                            </label>
                            ${settingsError ? html`<p class="error" role="alert">${settingsError}</p>` : ''}
                            <div class="settings-actions">
                                <button type="button" onClick=${connectWebSocket}>Connect</button>
                                <button class="secondary" type="button" onClick=${disconnectWebSocket}>Disconnect</button>
                                <button class="secondary" type="button" onClick=${() => {
                                    saveSyncSettings();
                                    showSettings = false;
                                    renderApp();
                                }}>Close</button>
                            </div>
                        </section>
                    </section>
                </div>
            `
                    : ''
            }

            ${
                pendingReplaceTasks
                    ? html`<div class="confirm-backdrop">
                        <section class="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="replace-confirm-title" aria-describedby="replace-confirm-description">
                            <h2 id="replace-confirm-title">Replace all current tasks?</h2>
                            <p id="replace-confirm-description">
                                This will replace your current list with ${pendingReplaceTasks.length} task${pendingReplaceTasks.length === 1 ? '' : 's'} from <strong>${pendingReplaceFilename}</strong>. This change will sync to connected devices and cannot be undone.
                            </p>
                            <div class="confirm-actions">
                                <button class="delete" type="button" onClick=${confirmReplaceTasks}>Replace tasks</button>
                                <button class="secondary" type="button" onClick=${cancelReplaceTasks}>Cancel</button>
                            </div>
                        </section>
                    </div>`
                    : ''
            }

            ${
                pendingDeleteTask
                    ? html`<div class="confirm-backdrop">
                        <section class="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-confirm-title" aria-describedby="delete-confirm-description">
                            <h2 id="delete-confirm-title">Delete this task?</h2>
                            <p id="delete-confirm-description">“${pendingDeleteTask.text}” will be deleted from this list and connected devices.</p>
                            <div class="confirm-actions">
                                <button class="delete" type="button" onClick=${confirmDeleteTask}>Delete task</button>
                                <button class="secondary" type="button" onClick=${cancelDeleteTask}>Keep task</button>
                            </div>
                        </section>
                    </div>`
                    : ''
            }
        </main>
    `;
}

function renderApp() {
    render(html`<${TodoApp} />`, document.getElementById('app'));
}

renderApp();
