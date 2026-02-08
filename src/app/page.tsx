"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  XCircle,
  Clock,
  HardDrive,
  ArrowUpDown,
  Activity,
  RefreshCw,
  TrendingUp,
  AlertTriangle,
} from "lucide-react";
import type { DashboardStats, RunStatus } from "@/lib/types";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return "—";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function statusColor(status: RunStatus | null): string {
  switch (status) {
    case "success": return "text-emerald-500";
    case "failure": return "text-red-500";
    case "running": return "text-blue-500";
    case "cancelled": return "text-yellow-500";
    case "skipped": return "text-gray-400";
    default: return "text-muted-foreground";
  }
}

function statusBadge(status: RunStatus | null) {
  switch (status) {
    case "success":
      return <Badge variant="outline" className="border-emerald-500/30 text-emerald-500 bg-emerald-500/10">Success</Badge>;
    case "failure":
      return <Badge variant="outline" className="border-red-500/30 text-red-500 bg-red-500/10">Failed</Badge>;
    case "running":
      return <Badge variant="outline" className="border-blue-500/30 text-blue-500 bg-blue-500/10">Running</Badge>;
    case "cancelled":
      return <Badge variant="outline" className="border-yellow-500/30 text-yellow-500 bg-yellow-500/10">Cancelled</Badge>;
    default:
      return <Badge variant="outline" className="text-muted-foreground">No runs</Badge>;
  }
}

function diskColor(percent: number): string {
  if (percent >= 90) return "bg-red-500";
  if (percent >= 70) return "bg-yellow-500";
  return "bg-emerald-500";
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/stats");
      const data = await res.json();
      setStats(data);
    } catch (e) {
      console.error("Failed to fetch stats", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 10000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-muted-foreground">Failed to load dashboard</p>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Overview of your homelab backup system
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchStats}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Active Jobs</p>
                <p className="text-3xl font-bold mt-1">{stats.active_jobs}</p>
                <p className="text-xs text-muted-foreground mt-1">of {stats.total_jobs} total</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Activity className="w-5 h-5 text-blue-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Success Rate</p>
                <p className="text-3xl font-bold mt-1">
                  {stats.total_runs > 0 ? Math.round((stats.successful_runs / stats.total_runs) * 100) : 0}%
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {stats.successful_runs} of {stats.total_runs} runs
                </p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-emerald-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Failed</p>
                <p className="text-3xl font-bold mt-1">{stats.failed_runs}</p>
                <p className="text-xs text-muted-foreground mt-1">need attention</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Data Backed Up</p>
                <p className="text-3xl font-bold mt-1">{formatBytes(stats.total_bytes_transferred)}</p>
                <p className="text-xs text-muted-foreground mt-1">{stats.last_24h_runs} runs today</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
                <ArrowUpDown className="w-5 h-5 text-purple-500" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Jobs Status */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Job Status Overview</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {stats.jobs_with_last_run.map((job) => (
                  <div
                    key={job.id}
                    className="flex items-center gap-4 p-3 rounded-lg border border-border/50 bg-card hover:bg-accent/30 transition-colors"
                  >
                    <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                      job.last_run_status === "success" ? "bg-emerald-500" :
                      job.last_run_status === "failure" ? "bg-red-500" :
                      job.last_run_status === "running" ? "bg-blue-500 animate-pulse" :
                      "bg-gray-500"
                    }`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{job.name}</p>
                      <p className="text-xs text-muted-foreground">{job.schedule}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      {statusBadge(job.last_run_status)}
                      <p className="text-[11px] text-muted-foreground mt-1">
                        {job.last_run_at ? timeAgo(job.last_run_at) : "Never run"}
                        {job.last_run_duration ? ` (${formatDuration(job.last_run_duration)})` : ""}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Recent Runs */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Recent Runs</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {stats.recent_runs.map((run) => (
                  <div key={run.id} className="flex items-center gap-3">
                    {run.status === "success" ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                    ) : run.status === "failure" ? (
                      <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                    ) : (
                      <Clock className="w-4 h-4 text-blue-500 flex-shrink-0 animate-spin" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{run.job_name || `Job #${run.job_id}`}</p>
                      <p className="text-xs text-muted-foreground truncate">{run.short_summary}</p>
                    </div>
                    <div className="text-right text-xs text-muted-foreground flex-shrink-0">
                      <p>{timeAgo(run.started_at)}</p>
                      <p>{formatDuration(run.duration_seconds)}</p>
                    </div>
                  </div>
                ))}
                {stats.recent_runs.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">No runs yet</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Disk Usage */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-muted-foreground" />
                <CardTitle className="text-base">Disk Usage</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              {stats.disks.map((disk) => (
                <div key={disk.mount} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{disk.label}</p>
                      <p className="text-[11px] text-muted-foreground font-mono">{disk.mount}</p>
                    </div>
                    <span className={`text-sm font-medium ${
                      disk.usage_percent >= 90 ? "text-red-500" :
                      disk.usage_percent >= 70 ? "text-yellow-500" :
                      "text-emerald-500"
                    }`}>
                      {disk.usage_percent}%
                    </span>
                  </div>
                  <Progress
                    value={disk.usage_percent}
                    className="h-2"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    {disk.used_gb} GB used of {disk.total_gb} GB ({disk.free_gb} GB free)
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Server Info (from settings) */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Server Info</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {stats.server_info?.server_hostname && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Host</span>
                  <span className="font-mono text-xs">{stats.server_info.server_hostname}</span>
                </div>
              )}
              {stats.server_info?.server_cpu && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">CPU</span>
                  <span className="font-mono text-xs">{stats.server_info.server_cpu}</span>
                </div>
              )}
              {stats.server_info?.server_ram && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">RAM</span>
                  <span className="font-mono text-xs">{stats.server_info.server_ram}</span>
                </div>
              )}
              {stats.server_info?.server_docker_ip && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Docker VM IP</span>
                  <span className="font-mono text-xs">{stats.server_info.server_docker_ip}</span>
                </div>
              )}
              {stats.server_info?.server_tailscale_ip && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tailscale IP</span>
                  <span className="font-mono text-xs">{stats.server_info.server_tailscale_ip}</span>
                </div>
              )}
              {stats.server_info?.server_proxmox_ip && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Proxmox</span>
                  <span className="font-mono text-xs">{stats.server_info.server_proxmox_ip}</span>
                </div>
              )}
              {!stats.server_info?.server_hostname && !stats.server_info?.server_docker_ip && (
                <p className="text-xs text-muted-foreground text-center py-2">
                  Configure in Settings → Server Info
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
