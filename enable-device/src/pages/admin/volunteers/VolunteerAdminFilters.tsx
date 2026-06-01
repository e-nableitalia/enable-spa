import { Panel } from "primereact/panel";
import { MultiSelect } from "primereact/multiselect";
import { InputText } from "primereact/inputtext";
import { Dropdown } from "primereact/dropdown";
import { InputNumber } from "primereact/inputnumber";
import { Button } from "primereact/button";
import { Divider } from "primereact/divider";
import type {
  ContinuityType,
  InvolvementLevel,
  UserRole,
} from "../../../shared/types/volunteerData";
import type { VolunteerAdminFilters as VolunteerAdminFiltersState } from "./volunteerAdminHelpers";

interface Option {
  label: string;
  value: string;
}

interface Props {
  filters: VolunteerAdminFiltersState;
  availableMainInterest: Option[];
  availableEnableInterestAreas: Option[];
  availablePrinterBrands: Option[];
  availablePrinterModels: Option[];
  onChange: (next: VolunteerAdminFiltersState) => void;
  onReset: () => void;
}

const BOOLEAN_FILTER_OPTIONS = [
  { label: "Tutti", value: null },
  { label: "Sì", value: true },
  { label: "No", value: false },
];

const CONTINUITY_OPTIONS: Array<{ label: string; value: ContinuityType }> = [
  { label: "Continuativa", value: "continuativa" },
  { label: "Spot", value: "spot" },
  { label: "Saltuaria", value: "saltuaria" },
];

const INVOLVEMENT_OPTIONS: Array<{ label: string; value: InvolvementLevel }> = [
  { label: "Bassa", value: "bassa" },
  { label: "Progetti", value: "progetti" },
  { label: "Coordinamento", value: "coordinamento" },
  { label: "Non so", value: "non so" },
];

const ROLE_OPTIONS: Array<{ label: string; value: UserRole }> = [
  { label: "Volunteer", value: "volunteer" },
  { label: "Admin", value: "admin" },
];

function fieldLabel(text: string) {
  return <label style={{ display: "block", fontSize: 13, marginBottom: 6 }}>{text}</label>;
}

function updateFilter<K extends keyof VolunteerAdminFiltersState>(
  current: VolunteerAdminFiltersState,
  key: K,
  value: VolunteerAdminFiltersState[K]
): VolunteerAdminFiltersState {
  return {
    ...current,
    [key]: value,
  };
}

export default function VolunteerAdminFilters({
  filters,
  availableMainInterest,
  availableEnableInterestAreas,
  availablePrinterBrands,
  availablePrinterModels,
  onChange,
  onReset,
}: Readonly<Props>) {
  return (
    <Panel header="Filtri">
      <div style={{ display: "grid", gap: 16 }}>
        <div>
          <h4 style={{ margin: "0 0 10px" }}>Ricerca generale</h4>
          <div>
            {fieldLabel("Ricerca globale")}
            <InputText
              value={filters.searchText}
              onChange={(e) => onChange(updateFilter(filters, "searchText", e.target.value))}
              placeholder="Cerca volontario, skill, città, stampante..."
              style={{ width: "100%" }}
            />
          </div>
        </div>

        <Divider style={{ margin: 0 }} />

        <div>
          <h4 style={{ margin: "0 0 10px" }}>Anagrafica e disponibilità</h4>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <div>
              {fieldLabel("Nome")}
              <InputText
                value={filters.firstName}
                onChange={(e) => onChange(updateFilter(filters, "firstName", e.target.value))}
                placeholder="Nome"
                style={{ width: "100%" }}
              />
            </div>
            <div>
              {fieldLabel("Cognome")}
              <InputText
                value={filters.lastName}
                onChange={(e) => onChange(updateFilter(filters, "lastName", e.target.value))}
                placeholder="Cognome"
                style={{ width: "100%" }}
              />
            </div>
            <div>
              {fieldLabel("Email")}
              <InputText
                value={filters.email}
                onChange={(e) => onChange(updateFilter(filters, "email", e.target.value))}
                placeholder="Email"
                style={{ width: "100%" }}
              />
            </div>
            <div>
              {fieldLabel("Città")}
              <InputText
                value={filters.city}
                onChange={(e) => onChange(updateFilter(filters, "city", e.target.value))}
                placeholder="Città"
                style={{ width: "100%" }}
              />
            </div>
            <div>
              {fieldLabel("Regione")}
              <InputText
                value={filters.region}
                onChange={(e) => onChange(updateFilter(filters, "region", e.target.value))}
                placeholder="Regione"
                style={{ width: "100%" }}
              />
            </div>
            <div>
              {fieldLabel("Disponibilità")}
              <InputText
                value={filters.availabilityText}
                onChange={(e) => onChange(updateFilter(filters, "availabilityText", e.target.value))}
                placeholder="Disponibilità"
                style={{ width: "100%" }}
              />
            </div>
            <div>
              {fieldLabel("Continuità")}
              <MultiSelect
                value={filters.continuityTypes}
                options={CONTINUITY_OPTIONS}
                onChange={(e) => onChange(updateFilter(filters, "continuityTypes", e.value as ContinuityType[]))}
                display="chip"
                optionLabel="label"
                optionValue="value"
                style={{ width: "100%" }}
              />
            </div>
            <div>
              {fieldLabel("Livello coinvolgimento")}
              <MultiSelect
                value={filters.involvementLevels}
                options={INVOLVEMENT_OPTIONS}
                onChange={(e) => onChange(updateFilter(filters, "involvementLevels", e.value as InvolvementLevel[]))}
                display="chip"
                optionLabel="label"
                optionValue="value"
                style={{ width: "100%" }}
              />
            </div>
            <div>
              {fieldLabel("Ruolo")}
              <MultiSelect
                value={filters.roles}
                options={ROLE_OPTIONS}
                onChange={(e) => onChange(updateFilter(filters, "roles", e.value as UserRole[]))}
                display="chip"
                optionLabel="label"
                optionValue="value"
                style={{ width: "100%" }}
              />
            </div>
            <div>
              {fieldLabel("Utente attivo?")}
              <Dropdown
                value={filters.active}
                options={BOOLEAN_FILTER_OPTIONS}
                onChange={(e) => onChange(updateFilter(filters, "active", e.value as boolean | null))}
                optionLabel="label"
                optionValue="value"
                placeholder="Tutti"
                style={{ width: "100%" }}
              />
            </div>
            <div>
              {fieldLabel("Ha stampanti attive?")}
              <Dropdown
                value={filters.hasActivePrinter}
                options={BOOLEAN_FILTER_OPTIONS}
                onChange={(e) => onChange(updateFilter(filters, "hasActivePrinter", e.value as boolean | null))}
                optionLabel="label"
                optionValue="value"
                placeholder="Tutti"
                style={{ width: "100%" }}
              />
            </div>
          </div>
        </div>

        <Divider style={{ margin: 0 }} />

        <div>
          <h4 style={{ margin: "0 0 10px" }}>Interessi e competenze</h4>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <div>
              {fieldLabel("Interessi principali")}
              <MultiSelect
                value={filters.mainInterest}
                options={availableMainInterest}
                onChange={(e) => onChange(updateFilter(filters, "mainInterest", e.value as string[]))}
                display="chip"
                optionLabel="label"
                optionValue="value"
                style={{ width: "100%" }}
              />
            </div>
            <div>
              {fieldLabel("Aree interesse e-Nable")}
              <MultiSelect
                value={filters.enableInterestAreas}
                options={availableEnableInterestAreas}
                onChange={(e) => onChange(updateFilter(filters, "enableInterestAreas", e.value as string[]))}
                display="chip"
                optionLabel="label"
                optionValue="value"
                style={{ width: "100%" }}
              />
            </div>
            <div>
              {fieldLabel("Skills")}
              <InputText
                value={filters.desiredSkillsText}
                onChange={(e) => onChange(updateFilter(filters, "desiredSkillsText", e.target.value))}
                placeholder="Cerca nelle skills"
                style={{ width: "100%" }}
              />
            </div>
          </div>
        </div>

        <Divider style={{ margin: 0 }} />

        <div>
          <h4 style={{ margin: "0 0 10px" }}>Stampanti</h4>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <div>
              {fieldLabel("Brand")}
              <MultiSelect
                value={filters.printerBrands}
                options={availablePrinterBrands}
                onChange={(e) => onChange(updateFilter(filters, "printerBrands", e.value as string[]))}
                display="chip"
                optionLabel="label"
                optionValue="value"
                style={{ width: "100%" }}
              />
            </div>
            <div>
              {fieldLabel("Modello")}
              <MultiSelect
                value={filters.printerModels}
                options={availablePrinterModels}
                onChange={(e) => onChange(updateFilter(filters, "printerModels", e.value as string[]))}
                display="chip"
                optionLabel="label"
                optionValue="value"
                style={{ width: "100%" }}
              />
            </div>
            <div>
              {fieldLabel("Materiali flessibili")}
              <Dropdown
                value={filters.supportsFlexible}
                options={BOOLEAN_FILTER_OPTIONS}
                onChange={(e) => onChange(updateFilter(filters, "supportsFlexible", e.value as boolean | null))}
                optionLabel="label"
                optionValue="value"
                placeholder="Qualsiasi"
                style={{ width: "100%" }}
              />
            </div>
            <div>
              {fieldLabel("Multi-materiale")}
              <Dropdown
                value={filters.supportsMultiMaterial}
                options={BOOLEAN_FILTER_OPTIONS}
                onChange={(e) => onChange(updateFilter(filters, "supportsMultiMaterial", e.value as boolean | null))}
                optionLabel="label"
                optionValue="value"
                placeholder="Qualsiasi"
                style={{ width: "100%" }}
              />
            </div>
            <div>
              {fieldLabel("Direct drive")}
              <Dropdown
                value={filters.hasDirectDrive}
                options={BOOLEAN_FILTER_OPTIONS}
                onChange={(e) => onChange(updateFilter(filters, "hasDirectDrive", e.value as boolean | null))}
                optionLabel="label"
                optionValue="value"
                placeholder="Qualsiasi"
                style={{ width: "100%" }}
              />
            </div>
            <div>
              {fieldLabel("Volume X minimo")}
              <InputNumber
                value={filters.minBuildVolumeX}
                onValueChange={(e) => onChange(updateFilter(filters, "minBuildVolumeX", e.value ?? null))}
                useGrouping={false}
                suffix=" mm"
                style={{ width: "100%" }}
              />
            </div>
            <div>
              {fieldLabel("Volume Y minimo")}
              <InputNumber
                value={filters.minBuildVolumeY}
                onValueChange={(e) => onChange(updateFilter(filters, "minBuildVolumeY", e.value ?? null))}
                useGrouping={false}
                suffix=" mm"
                style={{ width: "100%" }}
              />
            </div>
            <div>
              {fieldLabel("Volume Z minimo")}
              <InputNumber
                value={filters.minBuildVolumeZ}
                onValueChange={(e) => onChange(updateFilter(filters, "minBuildVolumeZ", e.value ?? null))}
                useGrouping={false}
                suffix=" mm"
                style={{ width: "100%" }}
              />
            </div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button label="Reset filtri" icon="pi pi-filter-slash" className="p-button-outlined" onClick={onReset} />
        </div>
      </div>
    </Panel>
  );
}
