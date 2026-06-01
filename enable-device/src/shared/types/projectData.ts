export type ProjectStatus =
  | "draft"
  | "active"
  | "paused"
  | "completed"
  | "archived";

export interface ProjectReferenceLink {
  label: string;
  url: string;
}

export interface ProjectVolunteer {
  uid: string;
  displayName?: string;
  role?: string;
}

export interface ProjectData {
  id?: string;
  name: string;
  description?: string;
  status: ProjectStatus;
  referenceLinks: ProjectReferenceLink[];
  volunteers: ProjectVolunteer[];
  volunteerUids: string[];
  notes?: string;
  createdByUid: string;
  createdByDisplayName?: string;
  createdAt: any;
  updatedAt?: any;
}
