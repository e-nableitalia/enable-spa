import type {
  ContinuityType,
  InvolvementLevel,
  UserRole,
  VolunteerData,
  VolunteerPrinter,
} from "../../../shared/types/volunteerData";

export interface VolunteerAdminRow {
  uid: string;
  firstName: string;
  lastName: string;
  email: string;
  city?: string;
  region?: string;
  phone?: string;
  telegramUsername?: string;
  role: UserRole;
  active: boolean;
  availability?: string;
  continuityType?: ContinuityType;
  desiredInvolvementLevel?: InvolvementLevel;
  mainInterest: string[];
  enableInterestAreas: string[];
  desiredSkills?: string;
  hasActivePrinter: boolean;
  printerBrands: string[];
  printerModels: string[];
  supportsFlexible: boolean;
  supportsMultiMaterial: boolean;
  hasDirectDrive: boolean;
  maxBuildVolumeX?: number;
  maxBuildVolumeY?: number;
  maxBuildVolumeZ?: number;
  raw: VolunteerData;
}

interface LegacyVolunteer {
  id?: string;
  uid?: string;
  active?: boolean;
  email?: string;
  role?: UserRole;
  createdAt?: unknown;
  firstName?: string;
  lastName?: string;
  phone?: string;
  city?: string;
  telegramUsername?: string;
  availability?: string;
  continuityType?: ContinuityType;
  desiredInvolvementLevel?: InvolvementLevel;
  desiredSkills?: string;
}

export interface VolunteerAdminFilters {
  searchText: string;
  firstName: string;
  lastName: string;
  email: string;
  city: string;
  region: string;
  availabilityText: string;
  continuityTypes: ContinuityType[];
  involvementLevels: InvolvementLevel[];
  roles: UserRole[];
  active: boolean | null;
  hasActivePrinter: boolean | null;
  mainInterest: string[];
  enableInterestAreas: string[];
  desiredSkillsText: string;
  printerBrands: string[];
  printerModels: string[];
  supportsFlexible: boolean | null;
  supportsMultiMaterial: boolean | null;
  hasDirectDrive: boolean | null;
  minBuildVolumeX: number | null;
  minBuildVolumeY: number | null;
  minBuildVolumeZ: number | null;
}

export const EMPTY_VOLUNTEER_ADMIN_FILTERS: VolunteerAdminFilters = {
  searchText: "",
  firstName: "",
  lastName: "",
  email: "",
  city: "",
  region: "",
  availabilityText: "",
  continuityTypes: [],
  involvementLevels: [],
  roles: [],
  active: null,
  hasActivePrinter: null,
  mainInterest: [],
  enableInterestAreas: [],
  desiredSkillsText: "",
  printerBrands: [],
  printerModels: [],
  supportsFlexible: null,
  supportsMultiMaterial: null,
  hasDirectDrive: null,
  minBuildVolumeX: null,
  minBuildVolumeY: null,
  minBuildVolumeZ: null,
};

export function fallbackVolunteerDataFromLegacy(legacyVolunteers: LegacyVolunteer[]): VolunteerData[] {
  return legacyVolunteers.map((legacy) => {
    const uid = legacy.uid ?? legacy.id ?? "";

    return {
      uid,
      core: {
        active: legacy.active === true,
        email: legacy.email ?? "",
        role: legacy.role ?? "volunteer",
        createdAt: legacy.createdAt,
      },
      privateProfile: {
        firstName: legacy.firstName ?? "",
        lastName: legacy.lastName ?? "",
        phone: legacy.phone,
        city: legacy.city,
        telegramUsername: legacy.telegramUsername,
        availability: legacy.availability,
        continuityType: legacy.continuityType,
        desiredInvolvementLevel: legacy.desiredInvolvementLevel,
        consentPrivacy: false,
      },
      skills: {
        desiredSkills: legacy.desiredSkills,
        mainInterest: [],
        enableInterestAreas: [],
      },
      printers: [],
      publicProfile: {
        showInVolunteerList: false,
      },
    };
  });
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter((item) => item.trim().length > 0)));
}

function maxValue(values: number[]): number | undefined {
  const sanitized = values.filter((value) => Number.isFinite(value) && value > 0);
  if (sanitized.length === 0) {
    return undefined;
  }
  return Math.max(...sanitized);
}

function resolveRegion(data: VolunteerData): string | undefined {
  const shippingAddress = data.privateProfile.shippingAddress as Record<string, unknown> | undefined;
  const region = shippingAddress?.region;
  return typeof region === "string" && region.trim().length > 0 ? region.trim() : undefined;
}

export function normalizeVolunteerForAdminRow(data: VolunteerData): VolunteerAdminRow {
  const activePrinters = data.printers.filter((printer) => printer.active);
  const printersForCapabilities = activePrinters.length > 0 ? activePrinters : data.printers;

  const printerBrands = unique(printersForCapabilities.map((printer) => printer.brand ?? ""));
  const printerModels = unique(printersForCapabilities.map((printer) => printer.model ?? ""));

  return {
    uid: data.uid,
    firstName: data.privateProfile.firstName ?? "",
    lastName: data.privateProfile.lastName ?? "",
    email: data.core.email ?? "",
    city: data.privateProfile.city,
    region: resolveRegion(data),
    phone: data.privateProfile.phone,
    telegramUsername: data.privateProfile.telegramUsername,
    role: data.core.role,
    active: data.core.active,
    availability: data.privateProfile.availability,
    continuityType: data.privateProfile.continuityType,
    desiredInvolvementLevel: data.privateProfile.desiredInvolvementLevel,
    mainInterest: data.skills.mainInterest ?? [],
    enableInterestAreas: data.skills.enableInterestAreas ?? [],
    desiredSkills: data.skills.desiredSkills,
    hasActivePrinter: activePrinters.length > 0,
    printerBrands,
    printerModels,
    supportsFlexible: printersForCapabilities.some((printer) => printer.flexibleSupported),
    supportsMultiMaterial: printersForCapabilities.some((printer) => printer.multiMaterial),
    hasDirectDrive: printersForCapabilities.some((printer) => printer.directDrive),
    maxBuildVolumeX: maxValue(printersForCapabilities.map((printer) => printer.buildVolumeX ?? 0)),
    maxBuildVolumeY: maxValue(printersForCapabilities.map((printer) => printer.buildVolumeY ?? 0)),
    maxBuildVolumeZ: maxValue(printersForCapabilities.map((printer) => printer.buildVolumeZ ?? 0)),
    raw: data,
  };
}

export function normalizeVolunteerRows(data: VolunteerData[]): VolunteerAdminRow[] {
  return data.map(normalizeVolunteerForAdminRow);
}

function containsText(value: string | undefined, needle: string): boolean {
  const normalizedNeedle = needle.trim().toLowerCase();
  if (!normalizedNeedle) {
    return true;
  }
  return (value ?? "").toLowerCase().includes(normalizedNeedle);
}

function arrayOverlap(values: string[], selected: string[]): boolean {
  if (selected.length === 0) {
    return true;
  }

  const normalizedValues = new Set(values.map((item) => item.toLowerCase()));
  return selected.some((item) => normalizedValues.has(item.toLowerCase()));
}

function matchesNullableBoolean(expected: boolean | null, actual: boolean): boolean {
  if (expected === null) {
    return true;
  }
  return actual === expected;
}

function matchesSelectedValue<T extends string>(actual: T | undefined, selected: T[]): boolean {
  if (selected.length === 0) {
    return true;
  }
  if (!actual) {
    return false;
  }
  return selected.includes(actual);
}

function matchesMinVolume(minimum: number | null, actual: number | undefined): boolean {
  if (minimum === null) {
    return true;
  }
  return (actual ?? 0) >= minimum;
}

function matchesGlobalSearch(row: VolunteerAdminRow, needle: string): boolean {
  if (!needle.trim()) {
    return true;
  }

  const text = [
    row.firstName,
    row.lastName,
    row.email,
    row.city ?? "",
    row.region ?? "",
    row.availability ?? "",
    row.desiredSkills ?? "",
    ...row.mainInterest,
    ...row.enableInterestAreas,
    ...row.printerBrands,
    ...row.printerModels,
  ]
    .join(" ")
    .toLowerCase();

  return text.includes(needle.trim().toLowerCase());
}

export function applyVolunteerAdminFilters(rows: VolunteerAdminRow[], filters: VolunteerAdminFilters): VolunteerAdminRow[] {
  return rows.filter((row) => {
    const checks = [
      matchesGlobalSearch(row, filters.searchText),
      containsText(row.firstName, filters.firstName),
      containsText(row.lastName, filters.lastName),
      containsText(row.email, filters.email),
      containsText(row.city, filters.city),
      containsText(row.region, filters.region),
      containsText(row.availability, filters.availabilityText),
      matchesSelectedValue(row.continuityType, filters.continuityTypes),
      matchesSelectedValue(row.desiredInvolvementLevel, filters.involvementLevels),
      matchesSelectedValue(row.role, filters.roles),
      matchesNullableBoolean(filters.active, row.active),
      matchesNullableBoolean(filters.hasActivePrinter, row.hasActivePrinter),
      arrayOverlap(row.mainInterest, filters.mainInterest),
      arrayOverlap(row.enableInterestAreas, filters.enableInterestAreas),
      containsText(row.desiredSkills, filters.desiredSkillsText),
      arrayOverlap(row.printerBrands, filters.printerBrands),
      arrayOverlap(row.printerModels, filters.printerModels),
      matchesNullableBoolean(filters.supportsFlexible, row.supportsFlexible),
      matchesNullableBoolean(filters.supportsMultiMaterial, row.supportsMultiMaterial),
      matchesNullableBoolean(filters.hasDirectDrive, row.hasDirectDrive),
      matchesMinVolume(filters.minBuildVolumeX, row.maxBuildVolumeX),
      matchesMinVolume(filters.minBuildVolumeY, row.maxBuildVolumeY),
      matchesMinVolume(filters.minBuildVolumeZ, row.maxBuildVolumeZ),
    ];

    return checks.every(Boolean);
  });
}

export function formatArray(values: string[] | undefined, emptyLabel = "-"): string {
  if (!values || values.length === 0) {
    return emptyLabel;
  }
  return values.join(", ");
}

export function formatBoolean(value: boolean | undefined): string {
  if (value === true) {
    return "Sì";
  }
  if (value === false) {
    return "No";
  }
  return "-";
}

export function formatFirestoreTimestamp(value: unknown): string {
  if (!value) {
    return "-";
  }

  if (value instanceof Date) {
    return value.toLocaleString();
  }

  if (typeof value === "object" && value !== null && "toDate" in value) {
    const maybeToDate = (value as { toDate?: () => Date }).toDate;
    if (typeof maybeToDate === "function") {
      return maybeToDate().toLocaleString();
    }
  }

  return "-";
}

export function printerVolumeText(printer: VolunteerPrinter): string {
  return `${printer.buildVolumeX} x ${printer.buildVolumeY} x ${printer.buildVolumeZ} mm`;
}
