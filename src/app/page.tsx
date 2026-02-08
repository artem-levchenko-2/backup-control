"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CheckCircle2,
  XCircle,
  HardDrive,
  ArrowUpDown,
  Activity,
  RefreshCw,
  TrendingUp,
  AlertTriangle,
  FileText,
  Loader2,
  Square,
  Ban,
} from "lucide-react";
import { toast } from "sonner";
import type { DashboardStats, Run, RunStatus } from "@/lib/types";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return "\u2014";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

/** Parse a date string from SQLite, ensuring UTC interpretation */
function parseUTC(dateStr: string): Date {
  // If the string has no timezone indicator, append "Z" so JS treats it as UTC
  if (!dateStr.endsWith("Z") && !dateStr.includes("+") && !dateStr.includes("T")) {
    return new Date(dateStr.replace(" ", "T") + "Z");
  }
  if (!dateStr.endsWith("Z") && !dateStr.includes("+")) {
    return new Date(dateStr + "Z");
  }
  return new Date(dateStr);
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const date = parseUTC(dateStr);
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

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loadingRun, setLoadingRun] = useState(false);
  const [stoppingRuns, setStoppingRuns] = useState<Set<number>>(new Set());

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

  // Also auto-refresh selected run if it's still running
  useEffect(() => {
    if (!selectedRun || selectedRun.status !== "running" || !dialogOpen) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/runs/${selectedRun.id}`);
        const data = await res.json();
        setSelectedRun(data);
        if (data.status !== "running") clearInterval(interval);
      } catch { /* ignore */ }
    }, 3000);
    return () => clearInterval(interval);
  }, [selectedRun, dialogOpen]);

  const handleStopRun = async (runId: number, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setStoppingRuns((prev) => new Set(prev).add(runId));
    try {
      const res = await fetch(`/api/runs/${runId}/stop`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message || "Stop signal sent");
        // Refresh after a moment
        setTimeout(() => {
          fetchStats();
          if (selectedRun?.id === runId) {
            fetch(`/api/runs/${runId}`).then(r => r.json()).then(setSelectedRun).catch(() => {});
          }
        }, 2000);
      } else {
        toast.error(data.error || "Failed to stop");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setStoppingRuns((prev) => {
        const next = new Set(prev);
        next.delete(runId);
        return next;
      });
    }
  };

  const openRunDetail = async (runId: number) => {
    setLoadingRun(true);
    setDialogOpen(true);
    try {
      const res = await fetch(`/api/runs/${runId}`);
      const data = await res.json();
      setSelectedRun(data);
    } catch {
      setSelectedRun(null);
    } finally {
      setLoadingRun(false);
    }
  };

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
              <div className="space-y-3">
                {stats.jobs_with_last_run.map((job) => {
                  const isRunning = job.last_run_status === "running";

                  return (
                    <div
                      key={job.id}
                      className={`p-3 rounded-lg border border-border/50 bg-card hover:bg-accent/30 transition-colors ${
                        job.last_run_id ? "cursor-pointer" : ""
                      }`}
                      onClick={() => job.last_run_id && openRunDetail(job.last_run_id)}
                    >
                      <div className="flex items-center gap-4">
                        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                          job.last_run_status === "success" ? "bg-emerald-500" :
                          job.last_run_status === "failure" ? "bg-red-500" :
                          isRunning ? "bg-blue-500 animate-pulse" :
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

                      {/* Live stats for running jobs */}
                      {isRunning && (
                        <div className="mt-3 flex items-center gap-3">
                          <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin flex-shrink-0" />
                          <p className="text-xs text-blue-400 flex-1 truncate">
                            {job.last_run_summary || "Starting..."}
                          </p>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 flex-shrink-0"
                            disabled={stoppingRuns.has(job.last_run_id!)}
                            onClick={(e) => handleStopRun(job.last_run_id!, e)}
                          >
                            {stoppingRuns.has(job.last_run_id!) ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Square className="w-3.5 h-3.5 mr-1" />
                            )}
                            Stop
                          </Button>
                        </div>
                      )}

                      {/* Compact summary for completed jobs */}
                      {!isRunning && job.last_run_bytes != null && job.last_run_bytes > 0 && (
                        <p className="mt-2 text-[11px] text-muted-foreground truncate ml-6">
                          {formatBytes(job.last_run_bytes)}, {job.last_run_files} files
                        </p>
                      )}
                    </div>
                  );
                })}
                {stats.jobs_with_last_run.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">No jobs configured</p>
                )}
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
                  <div
                    key={run.id}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent/30 transition-colors cursor-pointer -mx-2"
                    onClick={() => openRunDetail(run.id)}
                  >
                    {run.status === "success" ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                    ) : run.status === "failure" ? (
                      <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                    ) : run.status === "cancelled" ? (
                      <Ban className="w-4 h-4 text-yellow-500 flex-shrink-0" />
                    ) : (
                      <Loader2 className="w-4 h-4 text-blue-500 flex-shrink-0 animate-spin" />
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

        {/* Disk Usage + Server Info */}
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

          {/* Server Info */}
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
                  Configure in Settings &rarr; Server Info
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Run Detail Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Run Details
            </DialogTitle>
          </DialogHeader>
          {loadingRun ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : selectedRun ? (
            <div className="space-y-4">
              {/* Status Header */}
              <div className="flex items-center justify-between p-3 rounded-lg bg-accent/50">
                <div className="flex items-center gap-3">
                  {selectedRun.status === "success" ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                  ) : selectedRun.status === "failure" ? (
                    <XCircle className="w-5 h-5 text-red-500" />
                  ) : selectedRun.status === "cancelled" ? (
                    <Ban className="w-5 h-5 text-yellow-500" />
                  ) : (
                    <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
                  )}
                  <div>
                    <p className="font-medium">{selectedRun.job_name || `Job #${selectedRun.job_id}`}</p>
                    <p className="text-xs text-muted-foreground">Run #{selectedRun.id}</p>
                  </div>
                </div>
                {statusBadge(selectedRun.status)}
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-2.5 rounded-lg bg-accent/30 text-center">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Duration</p>
                  <p className="text-sm font-medium mt-0.5">
                    {selectedRun.status === "running"
                      ? formatDuration(Math.round((Date.now() - parseUTC(selectedRun.started_at).getTime()) / 1000))
                      : formatDuration(selectedRun.duration_seconds)
                    }
                  </p>
                </div>
                <div className="p-2.5 rounded-lg bg-accent/30 text-center">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Transferred</p>
                  <p className="text-sm font-medium mt-0.5">{formatBytes(selectedRun.bytes_transferred || 0)}</p>
                </div>
                <div className="p-2.5 rounded-lg bg-accent/30 text-center">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Files</p>
                  <p className="text-sm font-medium mt-0.5">{selectedRun.files_transferred || 0}</p>
                </div>
                <div className="p-2.5 rounded-lg bg-accent/30 text-center">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Errors</p>
                  <p className={`text-sm font-medium mt-0.5 ${selectedRun.errors_count > 0 ? "text-red-500" : ""}`}>
                    {selectedRun.errors_count}
                  </p>
                </div>
              </div>

              {/* Running Status + Stop */}
              {selectedRun.status === "running" && (
                <div className="flex items-center gap-3 p-3 rounded-lg border border-blue-500/20 bg-blue-500/5">
                  <Loader2 className="w-4 h-4 text-blue-500 animate-spin flex-shrink-0" />
                  <p className="text-sm text-blue-400 flex-1">{selectedRun.short_summary}</p>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="flex-shrink-0"
                    disabled={stoppingRuns.has(selectedRun.id)}
                    onClick={() => handleStopRun(selectedRun.id)}
                  >
                    {stoppingRuns.has(selectedRun.id) ? (
                      <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <Ban className="w-3.5 h-3.5 mr-1.5" />
                    )}
                    Force Stop
                  </Button>
                </div>
              )}

              {/* Summary */}
              {selectedRun.status !== "running" && selectedRun.short_summary && (
                <div className="p-3 rounded-lg border border-border/50 bg-card">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Summary</p>
                  <p className="text-sm">{selectedRun.short_summary}</p>
                </div>
              )}

              {/* Timing */}
              <div className="text-xs text-muted-foreground space-y-1">
                <p>Started: {parseUTC(selectedRun.started_at).toLocaleString()}</p>
                {selectedRun.finished_at && (
                  <p>Finished: {parseUTC(selectedRun.finished_at).toLocaleString()}</p>
                )}
              </div>

              {/* Log Output */}
              {selectedRun.log_excerpt && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Log Output</p>
                  <pre className="p-3 rounded-lg bg-black/50 border border-border/30 text-[11px] font-mono text-gray-300 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap break-all">
                    {selectedRun.log_excerpt}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">Run not found</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
