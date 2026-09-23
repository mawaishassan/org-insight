export interface ActivityLogItem {
  id: number;
  user_id: number | null;
  user_name: string;
  user_email: string;
  user_role?: string | null;
  user_department?: string | null;
  unique_user_key?: string | null;
  unique_key?: string | null;
  module: string;
  action_type: string;
  resource_type: string | null;
  resource_id: number | string | null;
  resource_name: string | null;
  reporting_period?: string | null;
  period?: string | null;
  action_details?: string | null;
  details?: string | null;
  metadata?: Record<string, unknown> | null;
  meta_data?: Record<string, unknown> | null;
  ip_address?: string | null;
  user_agent?: string | null;
  status: string;
  created_at: string;
}

export interface ActivityLogListResponse {
  items: ActivityLogItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface UserOverviewItem {
  user_id: number;
  username?: string;
  name?: string;
  full_name?: string | null;
  email?: string | null;
  unique_user_key?: string | null;
  role: string;
  department?: string | null;
  last_login_at: string | null;
  last_activity_at: string | null;
  login_count: number;
  total_activities?: number;
}

export interface UserOverviewListResponse {
  items: UserOverviewItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface DailyTrendPoint {
  date: string;
  count: number;
  logins?: number;
  active_users?: number;
}

export interface ModuleBreakdownItem {
  module: string;
  count: number;
  percentage?: number;
}

export interface TopActiveUser {
  user_id: number;
  name?: string;
  user_name?: string;
  email?: string;
  unique_user_key?: string | null;
  count?: number;
  activity_count?: number;
}

export interface UserStats {
  total_end_users: number;
  users_logged_in_today: number;
  users_logged_in_week: number;
  users_logged_in_month: number;
  never_logged_in: number;
  currently_active: number;
}

export interface ActivityStats {
  total_activities: number;
  reports_viewed: number;
  reports_downloaded: number;
  dashboards_viewed: number;
  dashboard_drilldowns: number;
  drilldown_downloads: number;
  kpi_data_saved: number;
  kpi_data_submitted: number;
  kpi_data_updated: number;
}

export interface ActivitySummaryResponse {
  // Nested backend models
  user_stats?: UserStats;
  activity_stats?: ActivityStats;
  daily_trend?: DailyTrendPoint[];
  top_active_users?: TopActiveUser[];

  // Flat convenience properties
  total_activities?: number;
  total_users?: number;
  active_users_7d?: number;
  logins_today?: number;
  activities_today?: number;
  daily_trends?: DailyTrendPoint[];
  module_breakdown?: ModuleBreakdownItem[];
  top_users?: TopActiveUser[];
}

export interface ActivityFilterState {
  search: string;
  userId?: number | null;
  module: string;
  actionType: string;
  status: string;
  startDate: string;
  endDate: string;
  page: number;
  pageSize: number;
}
