import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {TabPanel, TabView} from "primereact/tabview";
import {Button} from "primereact/button";
import {Dialog} from "primereact/dialog";
import {InputTextarea} from "primereact/inputtextarea";
import {Toast} from "primereact/toast";
import {DataTable} from "primereact/datatable";
import {Column} from "primereact/column";
import {Tag} from "primereact/tag";
import {httpsCallable} from "firebase/functions";
import {auth, functions} from "../../firebase";
import type {ProjectData} from "../../shared/types/projectData";
import type {TaskData, TaskPriority, TaskStatus, TaskType} from "../../shared/types/taskData";
import TaskDetailDialog from "../admin/tasks/TaskDetailDialog";
import TaskEditDialog from "../admin/tasks/TaskEditDialog";
import {
  assigneeLabel,
  asDateString,
  taskLinkedEntityLabel,
  taskPriorityLabel,
  taskPrioritySeverity,
  taskStatusLabel,
  taskStatusSeverity,
} from "../admin/tasks/taskHelpers";

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

export default function VolunteerTasksPage() {
  const toast = useRef<Toast>(null);
  const [tabIndex, setTabIndex] = useState(0);

  const [unassignedTasks, setUnassignedTasks] = useState<TaskData[]>([]);
  const [myTasks, setMyTasks] = useState<TaskData[]>([]);
  const [projects, setProjects] = useState<ProjectData[]>([]);
  const [volunteerOptions, setVolunteerOptions] = useState<VolunteerOption[]>([]);

  const [loadingUnassigned, setLoadingUnassigned] = useState(true);
  const [loadingMine, setLoadingMine] = useState(true);

  const [selectedTask, setSelectedTask] = useState<TaskData | null>(null);
  const [taskDetailVisible, setTaskDetailVisible] = useState(false);
  const [taskEditorVisible, setTaskEditorVisible] = useState(false);
  const [taskSaving, setTaskSaving] = useState(false);

  const [noteDialogVisible, setNoteDialogVisible] = useState(false);
  const [noteValue, setNoteValue] = useState("");

  const projectOptions = useMemo(
    () => projects.map((project) => ({id: project.id ?? "", name: project.name})).filter((item) => item.id.length > 0),
    [projects]
  );

  const selectedTaskLinkedLabel = useMemo(() => {
    if (!selectedTask) return "Generico";
    const projectName = projects.find((project) => project.id === selectedTask.linkedEntity?.projectId)?.name;
    return taskLinkedEntityLabel(selectedTask, projectName);
  }, [projects, selectedTask]);

  const myVolunteerAssignee = useMemo(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      return null;
    }

    const me = volunteerOptions.find((item) => item.uid === uid);
    return {
      type: "volunteer" as const,
      volunteerUid: uid,
      displayName: me?.displayName ?? auth.currentUser?.email ?? uid,
    };
  }, [volunteerOptions]);

  const loadReferenceData = useCallback(async () => {
    try {
      const [volunteersResult, projectsResult] = await Promise.all([
        httpsCallable<undefined, {volunteers: VolunteerOption[]}>(functions, "listVolunteerOptions")(),
        httpsCallable<Record<string, unknown>, {projects: ProjectData[]}>(functions, "listProjects")({}),
      ]);

      setVolunteerOptions(volunteersResult.data.volunteers ?? []);
      setProjects(projectsResult.data.projects ?? []);
    } catch (error) {
      console.error(error);
      toast.current?.show({severity: "error", summary: "Errore", detail: "Impossibile caricare anagrafiche task"});
    }
  }, []);

  const loadUnassigned = useCallback(async () => {
    setLoadingUnassigned(true);
    try {
      const fn = httpsCallable<Record<string, unknown>, {tasks: TaskData[]}>(functions, "listTasks");
      const result = await fn({view: "unassigned"});
      setUnassignedTasks(result.data.tasks ?? []);
    } catch (error) {
      console.error(error);
      toast.current?.show({severity: "error", summary: "Errore", detail: "Impossibile caricare i task non assegnati"});
    }
    setLoadingUnassigned(false);
  }, []);

  const loadMine = useCallback(async () => {
    setLoadingMine(true);
    try {
      const fn = httpsCallable<Record<string, unknown>, {tasks: TaskData[]}>(functions, "listTasks");
      const result = await fn({view: "mine"});
      setMyTasks(result.data.tasks ?? []);
    } catch (error) {
      console.error(error);
      toast.current?.show({severity: "error", summary: "Errore", detail: "Impossibile caricare i miei task"});
    }
    setLoadingMine(false);
  }, []);

  const refreshTasks = useCallback(async () => {
    await Promise.all([loadUnassigned(), loadMine()]);
  }, [loadMine, loadUnassigned]);

  useEffect(() => {
    void loadReferenceData();
    void refreshTasks();
  }, [loadReferenceData, refreshTasks]);

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
      await refreshTasks();
      toast.current?.show({severity: "success", summary: "OK", detail: "Task salvato"});
    } catch (error) {
      console.error(error);
      toast.current?.show({severity: "error", summary: "Errore", detail: "Errore salvataggio task"});
    }
    setTaskSaving(false);
  };

  const takeOwnership = async (task: TaskData) => {
    if (!task.id || !myVolunteerAssignee) {
      return;
    }

    try {
      const fn = httpsCallable(functions, "updateTask");
      await fn({taskId: task.id, assignees: [myVolunteerAssignee]});
      await refreshTasks();
      toast.current?.show({severity: "success", summary: "Task preso in carico"});
    } catch (error) {
      console.error(error);
      toast.current?.show({severity: "error", summary: "Errore", detail: "Presa in carico non riuscita"});
    }
  };

  const changeStatus = async (task: TaskData, newStatus: TaskStatus) => {
    try {
      const fn = httpsCallable(functions, "changeTaskStatus");
      await fn({taskId: task.id, newStatus});
      await refreshTasks();
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
      await refreshTasks();
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
      await refreshTasks();
      toast.current?.show({severity: "success", summary: "Nota aggiunta"});
    } catch (error) {
      console.error(error);
      toast.current?.show({severity: "error", summary: "Errore", detail: "Aggiunta nota non riuscita"});
    }
  };

  const projectNameById = useMemo(
    () => new Map(projects.map((project) => [project.id ?? "", project.name])),
    [projects]
  );

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

      <div style={{display: "flex", justifyContent: "space-between", alignItems: "center"}}>
        <h3 style={{margin: 0}}>Task volontari</h3>
        <Button
          label="Nuovo task"
          icon="pi pi-plus"
          onClick={() => {
            setSelectedTask(null);
            setTaskEditorVisible(true);
          }}
        />
      </div>

      <TabView activeIndex={tabIndex} onTabChange={(e) => setTabIndex(e.index)}>
        <TabPanel header={`Non assegnati (${unassignedTasks.length})`}>
          <DataTable value={unassignedTasks} dataKey="id" paginator rows={10} loading={loadingUnassigned} emptyMessage="Nessun task non assegnato">
            <Column field="title" header="Titolo" sortable />
            <Column field="type" header="Tipo" sortable />
            <Column
              header="Riferimento"
              body={(row: TaskData) => taskLinkedEntityLabel(row, projectNameById.get(row.linkedEntity?.projectId ?? ""))}
            />
            <Column
              field="status"
              header="Stato"
              body={(row: TaskData) => <Tag value={taskStatusLabel(row.status)} severity={taskStatusSeverity(row.status)} />}
              sortable
            />
            <Column
              field="priority"
              header="Priorita"
              body={(row: TaskData) => <Tag value={taskPriorityLabel(row.priority)} severity={taskPrioritySeverity(row.priority)} />}
              sortable
            />
            <Column field="createdAt" header="Creato" body={(row: TaskData) => asDateString(row.createdAt)} sortable />
            <Column
              header="Azioni"
              body={(row: TaskData) => (
                <div style={{display: "flex", gap: 4}}>
                  <Button
                    icon="pi pi-eye"
                    className="p-button-text"
                    onClick={() => {
                      setSelectedTask(row);
                      setTaskDetailVisible(true);
                    }}
                  />
                  <Button icon="pi pi-user-plus" className="p-button-text" onClick={() => takeOwnership(row)} />
                </div>
              )}
            />
          </DataTable>
        </TabPanel>

        <TabPanel header={`I miei task (${myTasks.length})`}>
          <DataTable value={myTasks} dataKey="id" paginator rows={10} loading={loadingMine} emptyMessage="Nessun task assegnato">
            <Column field="title" header="Titolo" sortable />
            <Column field="type" header="Tipo" sortable />
            <Column
              header="Riferimento"
              body={(row: TaskData) => taskLinkedEntityLabel(row, projectNameById.get(row.linkedEntity?.projectId ?? ""))}
            />
            <Column
              field="status"
              header="Stato"
              body={(row: TaskData) => <Tag value={taskStatusLabel(row.status)} severity={taskStatusSeverity(row.status)} />}
              sortable
            />
            <Column
              field="priority"
              header="Priorita"
              body={(row: TaskData) => <Tag value={taskPriorityLabel(row.priority)} severity={taskPrioritySeverity(row.priority)} />}
              sortable
            />
            <Column header="Assegnatari" body={(row: TaskData) => assigneeLabel(row.assignees)} />
            <Column field="updatedAt" header="Aggiornato" body={(row: TaskData) => asDateString(row.updatedAt)} sortable />
            <Column
              header="Cambio stato"
              body={(row: TaskData) => (
                <div style={{display: "flex", gap: 6, flexWrap: "wrap"}}>
                  <Button
                    label="Waiting volunteer"
                    className="p-button-text p-button-sm"
                    disabled={row.status === "waiting_volunteer"}
                    onClick={() => changeStatus(row, "waiting_volunteer")}
                  />
                  <Button
                    label="To do"
                    className="p-button-text p-button-sm"
                    disabled={row.status === "todo"}
                    onClick={() => changeStatus(row, "todo")}
                  />
                  <Button
                    label="In progress"
                    className="p-button-text p-button-sm"
                    disabled={row.status === "in_progress"}
                    onClick={() => changeStatus(row, "in_progress")}
                  />
                  <Button
                    label="Done"
                    className="p-button-text p-button-sm"
                    disabled={row.status === "done"}
                    onClick={() => changeStatus(row, "done")}
                  />
                </div>
              )}
            />
            <Column
              header="Azioni"
              body={(row: TaskData) => (
                <div style={{display: "flex", gap: 4}}>
                  <Button
                    icon="pi pi-eye"
                    className="p-button-text"
                    onClick={() => {
                      setSelectedTask(row);
                      setTaskDetailVisible(true);
                    }}
                  />
                  <Button
                    icon="pi pi-pencil"
                    className="p-button-text"
                    onClick={() => {
                      setSelectedTask(row);
                      setTaskEditorVisible(true);
                    }}
                  />
                  <Button
                    icon="pi pi-comment"
                    className="p-button-text"
                    onClick={() => {
                      setSelectedTask(row);
                      setNoteValue("");
                      setNoteDialogVisible(true);
                    }}
                  />
                  <Button icon="pi pi-trash" className="p-button-text p-button-danger" onClick={() => deleteTask(row)} />
                </div>
              )}
            />
          </DataTable>
        </TabPanel>
      </TabView>
    </div>
  );
}
