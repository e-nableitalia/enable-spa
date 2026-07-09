import { useEffect, useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../firebase";
import { DEVICE_TYPE_OPTIONS, OTHER_DEVICE_TYPE_OPTION } from "../../shared/constants/deviceTypes";

import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { InputText } from "primereact/inputtext";
import { InputNumber } from "primereact/inputnumber";
import { Dropdown } from "primereact/dropdown";
import { Toolbar } from "primereact/toolbar";
import { Toast } from "primereact/toast";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";

// ---- Types ----

interface TemplateItemForm {
  title: string;
  quantity: number | null;
}

interface ChecklistTemplate {
  id: string;
  title: string;
  items: TemplateItemForm[];
}

interface TemplateForm {
  title: string;
  items: TemplateItemForm[];
}

const EMPTY_ITEM: TemplateItemForm = { title: "", quantity: null };

const EMPTY_TEMPLATE_FORM: TemplateForm = {
  title: "",
  items: [],
};

const CATEGORY_OPTIONS = [
  ...DEVICE_TYPE_OPTIONS.map((label) => ({ label, value: label })),
  { label: "Altro", value: OTHER_DEVICE_TYPE_OPTION },
];

// ---- Component ----

/**
 * Sezione admin per la gestione del catalogo di template di checklist
 * Organizer, uno o più per ciascun tipo device (`devicetype`).
 *
 * Sola lettura via `listTemplates` (core Organizer, accessibile a
 * chiunque autenticato). Scrittura (creazione/modifica/eliminazione) via
 * il layer di integrazione device-requests (`createDeviceChecklistTemplate`,
 * `updateDeviceChecklistTemplate`, `deleteDeviceChecklistTemplate`), che
 * applica il controllo di ruolo admin prima di invocare il core.
 */
export default function AdminChecklistTemplatesPage() {
  const toast = useRef<Toast>(null);

  const [categoryOption, setCategoryOption] = useState<string>(DEVICE_TYPE_OPTIONS[0]);
  const [customCategory, setCustomCategory] = useState("");

  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [loading, setLoading] = useState(false);

  const [showDialog, setShowDialog] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ChecklistTemplate | null>(null);
  const [templateForm, setTemplateForm] = useState<TemplateForm>(EMPTY_TEMPLATE_FORM);
  const [saving, setSaving] = useState(false);

  const isCustomCategory = categoryOption === OTHER_DEVICE_TYPE_OPTION;
  const selectedCategory = (isCustomCategory ? customCategory : categoryOption).trim();

  const loadTemplates = async (category: string) => {
    if (!category) {
      setTemplates([]);
      return;
    }
    setLoading(true);
    try {
      const fn = httpsCallable<{ category: string }, { templates: ChecklistTemplate[] }>(
        functions,
        "listTemplates"
      );
      const result = await fn({ category });
      setTemplates(result.data.templates ?? []);
    } catch (err) {
      console.error("[AdminChecklistTemplatesPage] Failed to load templates", err);
      toast.current?.show({
        severity: "error",
        summary: "Errore",
        detail: "Impossibile caricare i template.",
        life: 4000,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loadTemplates fetches from a Cloud Function, not derivable from props/state
    loadTemplates(selectedCategory);
  }, [selectedCategory]);

  // ---- Dialog handlers ----

  const openNewTemplate = () => {
    setEditingTemplate(null);
    setTemplateForm(EMPTY_TEMPLATE_FORM);
    setShowDialog(true);
  };

  const openEditTemplate = (template: ChecklistTemplate) => {
    setEditingTemplate(template);
    setTemplateForm({
      title: template.title,
      items: template.items.map((item) => ({ ...item })),
    });
    setShowDialog(true);
  };

  const addItemRow = () => {
    setTemplateForm((f) => ({ ...f, items: [...f.items, { ...EMPTY_ITEM }] }));
  };

  const updateItemRow = (index: number, patch: Partial<TemplateItemForm>) => {
    setTemplateForm((f) => ({
      ...f,
      items: f.items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    }));
  };

  const removeItemRow = (index: number) => {
    setTemplateForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== index) }));
  };

  const saveTemplate = async () => {
    if (!selectedCategory) {
      toast.current?.show({
        severity: "warn",
        summary: "Tipo device richiesto",
        detail: "Seleziona o specifica un tipo device.",
        life: 3000,
      });
      return;
    }
    if (!templateForm.title.trim()) {
      toast.current?.show({
        severity: "warn",
        summary: "Campo obbligatorio",
        detail: "Il titolo del template è obbligatorio.",
        life: 3000,
      });
      return;
    }

    setSaving(true);
    try {
      const items = templateForm.items
        .filter((item) => item.title.trim() !== "")
        .map((item) => ({ title: item.title.trim(), quantity: item.quantity }));

      if (editingTemplate) {
        const fn = httpsCallable<
          { templateId: string; title: string; items: TemplateItemForm[] },
          { templateId: string }
        >(functions, "updateDeviceChecklistTemplate");
        await fn({ templateId: editingTemplate.id, title: templateForm.title.trim(), items });
        toast.current?.show({ severity: "success", summary: "Salvato", detail: "Template aggiornato.", life: 3000 });
      } else {
        const fn = httpsCallable<
          { category: string; title: string; items: TemplateItemForm[] },
          { templateId: string }
        >(functions, "createDeviceChecklistTemplate");
        await fn({ category: selectedCategory, title: templateForm.title.trim(), items });
        toast.current?.show({ severity: "success", summary: "Creato", detail: "Template creato.", life: 3000 });
      }

      setShowDialog(false);
      await loadTemplates(selectedCategory);
    } catch (err) {
      console.error("[AdminChecklistTemplatesPage] Failed to save template", err);
      toast.current?.show({
        severity: "error",
        summary: "Errore",
        detail: "Impossibile salvare il template. Solo gli admin possono gestire il catalogo.",
        life: 4000,
      });
    } finally {
      setSaving(false);
    }
  };

  const deleteTemplate = (template: ChecklistTemplate) => {
    confirmDialog({
      message: `Eliminare il template "${template.title}"?`,
      header: "Conferma eliminazione",
      icon: "pi pi-exclamation-triangle",
      acceptLabel: "Elimina",
      rejectLabel: "Annulla",
      acceptClassName: "p-button-danger",
      accept: async () => {
        try {
          const fn = httpsCallable<{ templateId: string }, { templateId: string }>(
            functions,
            "deleteDeviceChecklistTemplate"
          );
          await fn({ templateId: template.id });
          setTemplates((prev) => prev.filter((t) => t.id !== template.id));
          toast.current?.show({ severity: "success", summary: "Eliminato", life: 3000 });
        } catch (err) {
          console.error("[AdminChecklistTemplatesPage] Failed to delete template", err);
          toast.current?.show({
            severity: "error",
            summary: "Errore",
            detail: "Impossibile eliminare il template. Solo gli admin possono gestire il catalogo.",
            life: 4000,
          });
        }
      },
    });
  };

  // ---- Render ----

  const toolbarLeft = (
    <Button label="Nuovo template" icon="pi pi-plus" onClick={openNewTemplate} disabled={!selectedCategory} />
  );

  return (
    <div style={{ width: "100%", padding: 0 }}>
      <Toast ref={toast} />
      <ConfirmDialog />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          background: "linear-gradient(90deg, #7c3aed 0%, #a78bfa 100%)",
          color: "#fff",
          borderRadius: 12,
          padding: "24px 32px",
          marginBottom: 32,
          boxShadow: "0 2px 8px rgba(124,58,237,0.15)",
        }}
      >
        <span className="pi pi-list-check" style={{ fontSize: 32, marginRight: 16 }} />
        <div>
          <h2 style={{ margin: 0, fontWeight: 700 }}>Catalogo template checklist</h2>
          <p style={{ margin: 0, fontSize: 16 }}>
            Gestisci i template di checklist di fabbricazione per ciascun tipo device.
          </p>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <label style={{ fontWeight: 600 }}>Tipo device:</label>
        <Dropdown
          value={categoryOption}
          options={CATEGORY_OPTIONS}
          onChange={(e) => setCategoryOption(e.value)}
          style={{ minWidth: 240 }}
        />
        {isCustomCategory && (
          <InputText
            value={customCategory}
            onChange={(e) => setCustomCategory(e.target.value)}
            placeholder="Specifica il tipo device"
            style={{ minWidth: 240 }}
          />
        )}
      </div>

      <Toolbar left={toolbarLeft} style={{ marginBottom: 16 }} />

      <DataTable
        value={templates}
        loading={loading}
        paginator
        rows={20}
        rowsPerPageOptions={[10, 20, 50]}
        emptyMessage="Nessun template per questo tipo device."
      >
        <Column field="title" header="Titolo" style={{ minWidth: 200 }} />
        <Column
          header="Item"
          body={(row: ChecklistTemplate) => row.items?.length ?? 0}
          style={{ minWidth: 80 }}
        />
        <Column
          header="Azioni"
          body={(row: ChecklistTemplate) => (
            <div style={{ display: "flex", gap: 6 }}>
              <Button
                icon="pi pi-pencil"
                size="small"
                className="p-button-text p-button-secondary"
                tooltip="Modifica"
                onClick={() => openEditTemplate(row)}
              />
              <Button
                icon="pi pi-trash"
                size="small"
                className="p-button-text p-button-danger"
                tooltip="Elimina"
                onClick={() => deleteTemplate(row)}
              />
            </div>
          )}
          style={{ minWidth: 100 }}
        />
      </DataTable>

      <Dialog
        header={editingTemplate ? "Modifica template" : "Nuovo template"}
        visible={showDialog}
        onHide={() => setShowDialog(false)}
        style={{ width: 620 }}
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button label="Annulla" className="p-button-text" onClick={() => setShowDialog(false)} />
            <Button label="Salva" icon="pi pi-save" loading={saving} onClick={saveTemplate} />
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={{ fontWeight: 600, display: "block", marginBottom: 4 }}>Titolo *</label>
            <InputText
              value={templateForm.title}
              onChange={(e) => setTemplateForm((f) => ({ ...f, title: e.target.value }))}
              style={{ width: "100%" }}
              placeholder="Titolo del template"
            />
          </div>

          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <label style={{ fontWeight: 600 }}>Item</label>
              <Button label="Aggiungi item" icon="pi pi-plus" className="p-button-text p-button-sm" onClick={addItemRow} type="button" />
            </div>
            {templateForm.items.length === 0 && (
              <div style={{ color: "#aaa", fontSize: "0.9em" }}>Nessun item. Il template verrà creato vuoto.</div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {templateForm.items.map((item, index) => (
                <div key={index} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <InputText
                    value={item.title}
                    onChange={(e) => updateItemRow(index, { title: e.target.value })}
                    placeholder="Titolo item"
                    style={{ flex: 1 }}
                  />
                  <InputNumber
                    value={item.quantity}
                    onValueChange={(e) => updateItemRow(index, { quantity: e.value ?? null })}
                    placeholder="Qtà"
                    style={{ width: 100 }}
                    min={0}
                  />
                  <Button
                    icon="pi pi-trash"
                    className="p-button-text p-button-danger"
                    onClick={() => removeItemRow(index)}
                    type="button"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
