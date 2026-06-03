import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {TabPanel, TabView} from "primereact/tabview";
import {Button} from "primereact/button";
import {Panel} from "primereact/panel";
import {Divider} from "primereact/divider";
import {Dropdown} from "primereact/dropdown";
import {InputText} from "primereact/inputtext";
import {Dialog} from "primereact/dialog";
import {InputTextarea} from "primereact/inputtextarea";
import {Toast} from "primereact/toast";
import {httpsCallable} from "firebase/functions";
import {functions} from "../../../firebase";
import type {ProjectData, ProjectStatus} from "../../../shared/types/projectData";
import type {TaskData, TaskPriority, TaskStatus, TaskType} from "../../../shared/types/taskData";
import ProjectDetailDialog from "./ProjectDetailDialog";
import ProjectEditDialog from "./ProjectEditDialog";
import ProjectList from "./ProjectList";
import TaskDetailDialog from "./TaskDetailDialog";
import TaskEditDialog from "./TaskEditDialog";
import TaskFilters, {type TaskFilterState} from "./TaskFilters";
import TaskList from "./TaskList";
import {taskLinkedEntityLabel} from "./taskHelpers";

interface VolunteerOption {
  uid: string;
  displayName: string;
  email?: string | null;
}

interface TaskDraft {
  title: string;
  description: string;
  status: TaskStatus;
  type: TaskType;
  linkedDeviceRequestId: string;
  linkedProjectId: string;
  priority: TaskPriority;
  assignees: TaskData["assignees"];
  notes: string;
  notifyTelegramWaitingVolunteer: boolean;
}

interface ProjectDraft {
  name: string;
  description: string;
  status: ProjectStatus;
  referenceLinks: Array<{label: string; url: string}>;
  volunteers: Array<{uid: string; displayName?: string; role?: string}>;
  notes: string;
}

interface ProjectFilterState {
  searchText: string;
  status: ProjectStatus | "";
  volunteerUid: string;
}

const EMPTY_TASK_FILTERS: TaskFilterState = {
  searchText: "",
  status: "",
  priority: "",
  type: "",
  assigneeUid: "",
  deviceRequestId: "",
  projectId: "",
  createdFrom: null,
  createdTo: null,
};

const EMPTY_PROJECT_FILTERS: ProjectFilterState = {
  searchText: "",
  status: "",
  volunteerUid: "",
};

const PROJECT_STATUS_OPTIONS = [
  {label: "Draft", value: "draft"},
  {label: "Active", value: "active"},
  {label: "Paused", value: "paused"},
  {label: "Completed", value: "completed"},
  {label: "Archived", value: "archived"},
];

export default function AdminTasksPage() {
  const toast = useRef<Toast>(null);

  const [tasks, setTasks] = useState<TaskData[]>([]);
  const [projects, setProjects] = useState<ProjectData[]>([]);
  const [volunteerOptions, setVolunteerOptions] = useState<VolunteerOption[]>([]);
  const [taskFilters, setTaskFilters] = useState<TaskFilterState>(EMPTY_TASK_FILTERS);
  const [projectFilters, setProjectFilters] = useState<ProjectFilterState>(EMPTY_PROJECT_FILTERS);
  const [taskLoading, setTaskLoading] = useState(true);
  const [projectLoading, setProjectLoading] = useState(true);
  const [taskEditorVisible, setTaskEditorVisible] = useState(false);
  const [taskDetailVisible, setTaskDetailVisible] = useState(false);
  const [selectedTask, setSelectedTask] = useState<TaskData | null>(null);
  const [taskSaving, setTaskSaving] = useState(false);
  const [projectEditorVisible, setProjectEditorVisible] = useState(false);
  const [projectDetailVisible, setProjectDetailVisible] = useState(false);
  const [selectedProject, setSelectedProject] = useState<ProjectData | null>(null);
  const [projectSaving, setProjectSaving] = useState(false);
  const [noteDialogVisible, setNoteDialogVisible] = useState(false);
  const [noteValue, setNoteValue] = useState("");

  const projectOptions = useMemo(
    () => projects.map((project) => ({id: project.id ?? "", name: project.name})).filter((item) => item.id.length > 0),
    [projects]
  );

  const volunteerDropdownOptions = useMemo(
    () => volunteerOptions.map((volunteer) => ({label: volunteer.displayName, value: volunteer.uid})),
    [volunteerOptions]
  );

  const selectedTaskLinkedLabel = useMemo(() => {
    if (!selectedTask) return "Generico";
    const projectName = projects.find((project) => project.id === selectedTask.linkedEntity?.projectId)?.name;
    return taskLinkedEntityLabel(selectedTask, projectName);
  }, [projects, selectedTask]);

  const loadVolunteers = useCallback(async () => {
    const fn = httpsCallable<undefined, {volunteers: VolunteerOption[]}>(functions, "listVolunteerOptions");
    const result = await fn();
    setVolunteerOptions(result.data.volunteers ?? []);
  }, []);

  const loadTasks = useCallback(async (filters: TaskFilterState) => {
    setTaskLoading(true);
    try {
      const fn = httpsCallable<Record<string, unknown>, {tasks: TaskData[]}>(functions, "listTasks");
      const payload: Record<string, unknown> = {};
      if (filters.status) payload.status = filters.status;
      if (filters.priority) payload.priority = filters.priority;
      if (filters.type) payload.type = filters.type;
      if (filters.deviceRequestId) payload.deviceRequestId = filters.deviceRequestId;
      if (filters.projectId) payload.projectId = filters.projectId;
      if (filters.assigneeUid) payload.assigneeUid = filters.assigneeUid;
      if (filters.createdFrom) payload.createdFrom = filters.createdFrom.toISOString();
      if (filters.createdTo) payload.createdTo = filters.createdTo.toISOString();

      const result = await fn(payload);
      const fetched = result.data.tasks ?? [];
      const search = filters.searchText.trim().toLowerCase();

      const filtered = search
        ? fetched.filter((task) => {
          const haystack = `${task.title} ${task.description ?? ""} ${task.notes ?? ""}`.toLowerCase();
          return haystack.includes(search);
        })
        : fetched;

      setTasks(filtered);
    } catch (error) {
      console.error(error);
      toast.current?.show({severity: "error", summary: "Errore", detail: "Impossibile caricare i task"});
    }
    setTaskLoading(false);
  }, []);

  const loadProjects = useCallback(async (filters: ProjectFilterState) => {
    setProjectLoading(true);
    try {
      const fn = httpsCallable<Record<string, unknown>, {projects: ProjectData[]}>(functions, "listProjects");
      const payload: Record<string, unknown> = {};
      if (filters.status) payload.status = filters.status;
      if (filters.volunteerUid) payload.volunteerUid = filters.volunteerUid;
      if (filters.searchText) payload.searchText = filters.searchText;
      const result = await fn(payload);
      setProjects(result.data.projects ?? []);
    } catch (error) {
      console.error(error);
      toast.current?.show({severity: "error", summary: "Errore", detail: "Impossibile caricare i progetti"});
    }
    setProjectLoading(false);
  }, []);

  useEffect(() => {
    void loadVolunteers();
  }, [loadVolunteers]);

  useEffect(() => {
    void loadTasks(taskFilters);
  }, [loadTasks, taskFilters]);

  useEffect(() => {
    void loadProjects(projectFilters);
  }, [loadProjects, projectFilters]);

  const saveTask = async (draft: TaskDraft) => {
    setTaskSaving(true);
    try {
      if (selectedTask?.id) {
        const fn = httpsCallable(functions, "updateTask");
        await fn({
          taskId: selectedTask.id,
          title: draft.title,
          description: draft.description,
          type: draft.type,
          linkedEntity: {
            type: draft.type,
            deviceRequestId: draft.type === "deviceRequest" ? draft.linkedDeviceRequestId : undefined,
            projectId: draft.type === "project" ? draft.linkedProjectId : undefined,
          },
          priority: draft.priority,
          assignees: draft.assignees,
          notes: draft.notes,
        });
      } else {
        const fn = httpsCallable(functions, "createTask");
        await fn({
          title: draft.title,
          description: draft.description,
          type: draft.type,
          linkedEntity: {
            type: draft.type,
            deviceRequestId: draft.type === "deviceRequest" ? draft.linkedDeviceRequestId : undefined,
            projectId: draft.type === "project" ? draft.linkedProjectId : undefined,
          },
          status: draft.status,
          priority: draft.priority,
          assignees: draft.assignees,
          notes: draft.notes,
          notifyTelegramWaitingVolunteer: draft.notifyTelegramWaitingVolunteer,
        });
      }

      setTaskEditorVisible(false);
      setSelectedTask(null);
      await loadTasks(taskFilters);
      toast.current?.show({severity: "success", summary: "OK", detail: "Task salvato"});
    } catch (error) {
      console.error(error);
      toast.current?.show({severity: "error", summary: "Errore", detail: "Errore salvataggio task"});
    }
    setTaskSaving(false);
  };

  const changeStatus = async (task: TaskData, newStatus: TaskStatus) => {
    try {
      const fn = httpsCallable(functions, "changeTaskStatus");
      await fn({taskId: task.id, newStatus});
      await loadTasks(taskFilters);
      toast.current?.show({severity: "success", summary: "Stato aggiornato"});
    } catch (error) {
      console.error(error);
      toast.current?.show({severity: "error", summary: "Errore", detail: "Cambio stato non riuscito"});
    }
  };

  const deleteTask = async (task: TaskData) => {
    try {
      const fn = httpsCallable(functions, "deleteTask");
      await fn({taskId: task.id});
      await loadTasks(taskFilters);
      toast.current?.show({severity: "success", summary: "Task archiviato"});
    } catch (error) {
      console.error(error);
      toast.current?.show({severity: "error", summary: "Errore", detail: "Delete task non riuscita"});
    }
  };

  const submitNote = async () => {
    if (!selectedTask?.id || !noteValue.trim()) {
      return;
    }
    try {
      const fn = httpsCallable(functions, "addTaskNote");
      await fn({taskId: selectedTask.id, note: noteValue});
      setNoteDialogVisible(false);
      setNoteValue("");
      await loadTasks(taskFilters);
      toast.current?.show({severity: "success", summary: "Nota aggiunta"});
    } catch (error) {
      console.error(error);
      toast.current?.show({severity: "error", summary: "Errore", detail: "Aggiunta nota non riuscita"});
    }
  };

  const saveProject = async (draft: ProjectDraft) => {
    setProjectSaving(true);
    try {
      if (selectedProject?.id) {
        const fn = httpsCallable(functions, "updateProject");
        await fn({projectId: selectedProject.id, ...draft});
      } else {
        const fn = httpsCallable(functions, "createProject");
        await fn(draft);
      }
      setProjectEditorVisible(false);
      setSelectedProject(null);
      await loadProjects(projectFilters);
      await loadTasks(taskFilters);
      toast.current?.show({severity: "success", summary: "Progetto salvato"});
    } catch (error) {
      console.error(error);
      toast.current?.show({severity: "error", summary: "Errore", detail: "Salvataggio progetto non riuscito"});
    }
    setProjectSaving(false);
  };

  const archiveProject = async (project: ProjectData) => {
    try {
      const fn = httpsCallable(functions, "deleteProject");
      await fn({projectId: project.id});
      await loadProjects(projectFilters);
      toast.current?.show({severity: "success", summary: "Progetto archiviato"});
    } catch (error) {
      console.error(error);
      toast.current?.show({severity: "error", summary: "Errore", detail: "Archiviazione progetto non riuscita"});
    }
  };

  return (
    <div style={{display: "grid", gap: 12}}>
      <Toast ref={toast} />

      <TaskEditDialog
        visible={taskEditorVisible}
        task={selectedTask}
        volunteers={volunteerOptions}
        projects={projectOptions}
        onHide={() => {
          setTaskEditorVisible(false);
          setSelectedTask(null);
        }}
        onSave={saveTask}
        saving={taskSaving}
      />

      <TaskDetailDialog
        visible={taskDetailVisible}
        task={selectedTask}
        linkedLabel={selectedTaskLinkedLabel}
        onHide={() => setTaskDetailVisible(false)}
      />

      <ProjectEditDialog
        visible={projectEditorVisible}
        project={selectedProject}
        volunteerOptions={volunteerOptions.map((item) => ({uid: item.uid, displayName: item.displayName}))}
        onHide={() => {
          setProjectEditorVisible(false);
          setSelectedProject(null);
        }}
        onSave={saveProject}
        saving={projectSaving}
      />

      <ProjectDetailDialog
        visible={projectDetailVisible}
        project={selectedProject}
        onHide={() => setProjectDetailVisible(false)}
      />

      <Dialog
        header="Aggiungi nota"
        visible={noteDialogVisible}
        onHide={() => setNoteDialogVisible(false)}
        style={{width: "480px"}}
        footer={
          <div style={{display: "flex", justifyContent: "flex-end", gap: 8}}>
            <Button label="Annulla" className="p-button-text" onClick={() => setNoteDialogVisible(false)} />
            <Button label="Salva" onClick={submitNote} disabled={!noteValue.trim()} />
          </div>
        }
      >
        <InputTextarea value={noteValue} onChange={(e) => setNoteValue(e.target.value)} rows={5} style={{width: "100%"}} />
      </Dialog>

      <TabView>
        <TabPanel header="Tasks">
          <div style={{display: "grid", gap: 10}}>
            <div style={{display: "flex", justifyContent: "space-between", alignItems: "center"}}>
              <h3 style={{margin: 0}}>Task / Work items</h3>
              <Button
                label="Nuovo task"
                icon="pi pi-plus"
                onClick={() => {
                  setSelectedTask(null);
                  setTaskEditorVisible(true);
                }}
              />
            </div>

            <TaskFilters
              filters={taskFilters}
              projectOptions={projectOptions.map((item) => ({label: item.name, value: item.id}))}
              volunteerOptions={volunteerDropdownOptions}
              onChange={setTaskFilters}
              onReset={() => setTaskFilters(EMPTY_TASK_FILTERS)}
            />

            <div style={{fontSize: 14}}>{tasks.length} task trovati</div>

            <TaskList
              tasks={tasks}
              projects={projects}
              loading={taskLoading}
              onDetail={(task) => {
                setSelectedTask(task);
                setTaskDetailVisible(true);
              }}
              onEdit={(task) => {
                setSelectedTask(task);
                setTaskEditorVisible(true);
              }}
              onDelete={deleteTask}
              onAddNote={(task) => {
                setSelectedTask(task);
                setNoteValue("");
                setNoteDialogVisible(true);
              }}
              onStatusChange={changeStatus}
            />
          </div>
        </TabPanel>

        <TabPanel header="Progetti">
          <div style={{display: "grid", gap: 10}}>
            <div style={{display: "flex", justifyContent: "space-between", alignItems: "center"}}>
              <h3 style={{margin: 0}}>Inventario progetti</h3>
              <Button
                label="Nuovo progetto"
                icon="pi pi-plus"
                onClick={() => {
                  setSelectedProject(null);
                  setProjectEditorVisible(true);
                }}
              />
            </div>

            <Panel header="Filtri progetti" toggleable>
              <div style={{display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12}}>
                <div>
                  <label>Ricerca testo</label>
                  <InputText
                    value={projectFilters.searchText}
                    onChange={(e) => setProjectFilters((prev) => ({...prev, searchText: e.target.value}))}
                    style={{width: "100%"}}
                  />
                </div>
                <div>
                  <label>Stato</label>
                  <Dropdown
                    value={projectFilters.status}
                    options={PROJECT_STATUS_OPTIONS}
                    optionLabel="label"
                    optionValue="value"
                    onChange={(e) => setProjectFilters((prev) => ({...prev, status: (e.value as ProjectStatus | "") ?? ""}))}
                    showClear
                    style={{width: "100%"}}
                  />
                </div>
                <div>
                  <label>Volontario coinvolto</label>
                  <Dropdown
                    value={projectFilters.volunteerUid}
                    options={volunteerDropdownOptions}
                    optionLabel="label"
                    optionValue="value"
                    onChange={(e) => setProjectFilters((prev) => ({...prev, volunteerUid: (e.value as string) ?? ""}))}
                    showClear
                    style={{width: "100%"}}
                  />
                </div>
              </div>
              <Divider style={{margin: "12px 0"}} />
              <div style={{display: "flex", justifyContent: "flex-end"}}>
                <Button label="Reset" className="p-button-text" onClick={() => setProjectFilters(EMPTY_PROJECT_FILTERS)} />
              </div>
            </Panel>

            <div style={{fontSize: 14}}>{projects.length} progetti trovati</div>

            <ProjectList
              projects={projects}
              loading={projectLoading}
              onDetail={(project) => {
                setSelectedProject(project);
                setProjectDetailVisible(true);
              }}
              onEdit={(project) => {
                setSelectedProject(project);
                setProjectEditorVisible(true);
              }}
              onArchive={archiveProject}
            />
          </div>
        </TabPanel>
      </TabView>
    </div>
  );
}
