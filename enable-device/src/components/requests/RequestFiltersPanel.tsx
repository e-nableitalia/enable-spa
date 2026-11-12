import { useState } from "react";
import type { ReactNode } from "react";
import { InputText } from "primereact/inputtext";
import { MultiSelect } from "primereact/multiselect";
import { Dropdown } from "primereact/dropdown";
import { Calendar } from "primereact/calendar";
import { Button } from "primereact/button";
import { Panel } from "primereact/panel";
import { Tag } from "primereact/tag";
import {
  BASE_FILTER_KEYS,
  EXTENDED_FILTER_KEYS,
  countActiveFilters,
  fromDateKey,
  toDateKey,
} from "./requestListFilters";
import type { RequestListFilters } from "./requestListFilters";

export interface FilterOption {
  label: string;
  value: string;
}

export interface ColumnOption {
  key: string;
  label: string;
}

interface Props {
  /** "admin" mostra anche ID, Seq, destinatario, genere, amputazione, volontari, attenzione. */
  scope: "admin" | "volunteer";
  filters: RequestListFilters;
  onChange: <K extends keyof RequestListFilters>(key: K, value: RequestListFilters[K]) => void;
  onReset: () => void;
  statusOptions: FilterOption[];
  publicStatusOptions: FilterOption[];
  deviceTypeOptions: FilterOption[];
  genderOptions?: FilterOption[];
  amputationTypeOptions?: FilterOption[];
  columns: ColumnOption[];
  visibleColumns: string[];
  onVisibleColumnsChange: (keys: string[]) => void;
}

const ATTENTION_OPTIONS = [
  { label: "Tutti", value: null },
  { label: "Sì", value: true },
  { label: "No", value: false },
];

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <label style={{ fontSize: 13 }}>{label}</label>
      {children}
    </div>
  );
}

export default function RequestFiltersPanel({
  scope,
  filters,
  onChange,
  onReset,
  statusOptions,
  publicStatusOptions,
  deviceTypeOptions,
  genderOptions = [],
  amputationTypeOptions = [],
  columns,
  visibleColumns,
  onVisibleColumnsChange,
}: Props) {
  const [collapsed, setCollapsed] = useState(true);
  const isAdmin = scope === "admin";

  const extendedKeys = EXTENDED_FILTER_KEYS;
  const extendedActive = countActiveFilters(filters, extendedKeys);
  const totalActive = countActiveFilters(filters, [...BASE_FILTER_KEYS, ...extendedKeys]);

  const text = (key: "seqId" | "firstName" | "lastName", placeholder: string, flex: string) => (
    <span className="p-input-icon-left" style={{ flex }}>
      <i className="pi pi-search" style={{ left: "0.75rem" }} />
      <InputText
        value={filters[key]}
        onChange={(e) => onChange(key, e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        style={{ paddingLeft: "2rem", width: "100%" }}
      />
    </span>
  );

  const textField = (
    key: "requestNumber" | "recipient" | "province" | "assignedVolunteers",
    label: string
  ) => (
    <Field label={label}>
      <InputText
        value={filters[key]}
        onChange={(e) => onChange(key, e.target.value)}
        aria-label={label}
      />
    </Field>
  );

  const multi = (
    key: "genders" | "amputationTypes" | "deviceTypes" | "publicStatuses",
    label: string,
    options: FilterOption[]
  ) => (
    <Field label={label}>
      <MultiSelect
        value={filters[key]}
        options={options}
        onChange={(e) => onChange(key, e.value)}
        display="chip"
        placeholder="Tutti"
        aria-label={label}
      />
    </Field>
  );

  const dateRange = (
    label: string,
    fromKey: "createdFrom" | "updatedFrom",
    toKey: "createdTo" | "updatedTo"
  ) => (
    <Field label={label}>
      <div style={{ display: "flex", gap: 6 }}>
        <Calendar
          value={fromDateKey(filters[fromKey])}
          onChange={(e) => onChange(fromKey, e.value instanceof Date ? toDateKey(e.value) : null)}
          dateFormat="dd/mm/yy"
          placeholder="Dal"
          showButtonBar
          style={{ flex: 1, minWidth: 0 }}
          inputStyle={{ width: "100%" }}
        />
        <Calendar
          value={fromDateKey(filters[toKey])}
          onChange={(e) => onChange(toKey, e.value instanceof Date ? toDateKey(e.value) : null)}
          dateFormat="dd/mm/yy"
          placeholder="Al"
          showButtonBar
          style={{ flex: 1, minWidth: 0 }}
          inputStyle={{ width: "100%" }}
        />
      </div>
    </Field>
  );

  return (
    <div style={{ marginBottom: 10 }}>
      {/* Filtri base, sempre visibili */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 8 }}>
        {isAdmin && text("seqId", "ID", "0 1 110px")}
        {text("firstName", "Nome", "1 1 130px")}
        {text("lastName", "Cognome", "1 1 130px")}
        <MultiSelect
          value={filters.statuses}
          options={statusOptions}
          onChange={(e) => onChange("statuses", e.value)}
          placeholder="Stato"
          aria-label="Stato"
          display="chip"
          style={{ flex: "1 1 160px", minWidth: 0 }}
        />
        <Button
          label="Azzera filtri"
          icon="pi pi-filter-slash"
          severity="secondary"
          outlined
          onClick={onReset}
          disabled={totalActive === 0}
        />
        <MultiSelect
          value={visibleColumns}
          options={columns}
          optionLabel="label"
          optionValue="key"
          onChange={(e) => onVisibleColumnsChange(e.value)}
          placeholder="Colonne visibili"
          aria-label="Colonne visibili"
          maxSelectedLabels={0}
          selectedItemsLabel="{0} colonne visibili"
          style={{ minWidth: 170 }}
        />
      </div>

      {/* Filtri estesi, collassabili */}
      <Panel
        toggleable
        collapsed={collapsed}
        onToggle={(e) => setCollapsed(e.value)}
        headerTemplate={(options) => (
          <div
            className={options.className}
            role="button"
            tabIndex={0}
            aria-expanded={!options.collapsed}
            style={{ cursor: "pointer" }}
            onClick={options.onTogglerClick}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                options.onTogglerClick(e as unknown as React.MouseEvent<HTMLElement>);
              }
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
              Filtri estesi
              {extendedActive > 0 && (
                <Tag
                  value={`${extendedActive} ${extendedActive === 1 ? "attivo" : "attivi"}`}
                  severity="info"
                  data-testid="extended-filters-active"
                />
              )}
            </span>
            <i className={options.collapsed ? "pi pi-plus" : "pi pi-minus"} />
          </div>
        )}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
            gap: 12,
          }}
        >
          {isAdmin && textField("requestNumber", "Seq")}
          {isAdmin && textField("recipient", "Destinatario")}
          <Field label="Età">
            <InputText
              type="number"
              value={filters.age === null ? "" : String(filters.age)}
              onChange={(e) => onChange("age", e.target.value === "" ? null : Number(e.target.value))}
              aria-label="Età"
            />
          </Field>
          {isAdmin && multi("genders", "Genere", genderOptions)}
          {isAdmin && multi("amputationTypes", "Tipo amputazione", amputationTypeOptions)}
          {multi("deviceTypes", "Device", deviceTypeOptions)}
          {multi("publicStatuses", "Stato pubblico", publicStatusOptions)}
          {textField("province", "Provincia")}
          {isAdmin && textField("assignedVolunteers", "Volontari assegnati")}
          {isAdmin && (
            <Field label="Richiede attenzione">
              <Dropdown
                value={filters.requiresAttention}
                options={ATTENTION_OPTIONS}
                optionValue="value"
                optionLabel="label"
                onChange={(e) => onChange("requiresAttention", e.value)}
                aria-label="Richiede attenzione"
              />
            </Field>
          )}
          {dateRange("Creata", "createdFrom", "createdTo")}
          {dateRange("Aggiornata", "updatedFrom", "updatedTo")}
        </div>
      </Panel>
    </div>
  );
}
