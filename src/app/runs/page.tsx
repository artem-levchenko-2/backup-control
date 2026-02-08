"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  FileText,
  Timer,
  HardDrive,
  FileStack,
  AlertTriangle,
} from "lucide-react";
import type { Run, RunStatus } from "@/lib/types";

function formatBytes(bytes: number | null): string {
  if (!bytes || bytes === 0) return "0 B";
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

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleString("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusIcon(status: RunStatus) {
  switch (status) {
    case "success":
      return <CheckCircle2 className="w-5 h-5 text-emerald-500" />;
    case "failure":
      return <XCircle className="w-5 h-5 text-red-500" />;
    case "running":
      return <RefreshCw className="w-5 h-5 text-blue-500 animate-spin" />;
    case "cancelled":
      return <AlertTriangle className="w-5 h-5 text-yellow-500" />;
    default:
      return <Clock className="w-5 h-5 text-gray-400" />;
  }
}

function statusBadge(status: RunStatus) {
  const map: Record<string, { cls: string; label: string }> = {
    success: { cls: "border-emerald-500/30 text-emerald-500 bg-emerald-500/10", label: "Success" },
    failure: { cls: "border-red-500/30 text-red-500 bg-red-500/10", label: "Failed" },
    running: { cls: "border-blue-500/30 text-blue-500 bg-blue-500/10", label: "Running" },
    cancelled: { cls: "border-yellow-500/30 text-yellow-500 bg-yellow-500/10", label: "Cancelled" },
    skipped: { cls: "border-gray-500/30 text-gray-400 bg-gray-500/10", label: "Skipped" },
  };
  const cfg = map[status] || map.skipped;
  return <Badge variant="outline" className={cfg.cls}>{cfg.label}</Badge>;
}

export default function RunsPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);

  const fetchRuns = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filterStatus !== "all") params.set("status", filterStatus);
      params.set("limit", "50");
      const res = await fetch(`/api/runs?${params}`);
      const data = await res.json();
      setRuns(data);
    } catch (e) {
      console.error("Failed to fetch runs", e);
    } finally {
      setLoading(false);
    }
  }, [filterStatus]);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Run History</h1>
          <p className="text-sm text-muted-foreground mt-1">
            View all past and active job executions
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Filter" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="success">Success</SelectItem>
              <SelectItem value="failure">Failed</SelectItem>
              <SelectItem value="running">Running</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={fetchRuns}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Runs List */}
      <div className="space-y-3">
        {runs.map((run) => (
          <Card
            key={run.id}
            className="cursor-pointer hover:bg-accent/30 transition-colors"
            onClick={() => setSelectedRun(run)}
          >
            <CardContent className="py-4">
              <div className="flex items-center gap-4">
                <div className="flex-shrink-0">
                  {statusIcon(run.status)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium">{run.job_name || `Job #${run.job_id}`}</p>
                    {statusBadge(run.status)}
                    <span className="text-xs text-muted-foreground">Run #{run.id}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 truncate">
                    {run.short_summary || "No summary available"}
                  </p>
                </div>
                <div className="hidden sm:flex items-center gap-6 text-xs text-muted-foreground flex-shrink-0">
                  <div className="flex items-center gap-1.5">
                    <Timer className="w-3.5 h-3.5" />
                    <span>{formatDuration(run.duration_seconds)}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <HardDrive className="w-3.5 h-3.5" />
                    <span>{formatBytes(run.bytes_transferred)}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <FileStack className="w-3.5 h-3.5" />
                    <span>{run.files_transferred ?? 0} files</span>
                  </div>
                </div>
                <div className="text-right text-xs text-muted-foreground flex-shrink-0">
                  <p>{formatDate(run.started_at)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {runs.length === 0 && (
        <div className="text-center py-12">
          <Clock className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No runs found</p>
          <p className="text-sm text-muted-foreground mt-1">Go to Jobs and click "Run Now" to start a job</p>
        </div>
      )}

      {/* Run Detail Dialog */}
      <Dialog open={!!selectedRun} onOpenChange={() => setSelectedRun(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          {selectedRun && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-3">
                  {statusIcon(selectedRun.status)}
                  <div>
                    <DialogTitle>{selectedRun.job_name || `Job #${selectedRun.job_id}`}</DialogTitle>
                    <p className="text-xs text-muted-foreground mt-1">
                      Run #{selectedRun.id} &middot; {formatDate(selectedRun.started_at)}
                    </p>
                  </div>
                </div>
              </DialogHeader>
              <div className="space-y-4">
                {/* Stats */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-3 rounded-lg bg-accent/50">
                    <p className="text-[11px] text-muted-foreground uppercase">Status</p>
                    <div className="mt-1">{statusBadge(selectedRun.status)}</div>
                  </div>
                  <div className="p-3 rounded-lg bg-accent/50">
                    <p className="text-[11px] text-muted-foreground uppercase">Duration</p>
                    <p className="text-sm font-medium mt-1">{formatDuration(selectedRun.duration_seconds)}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-accent/50">
                    <p className="text-[11px] text-muted-foreground uppercase">Data</p>
                    <p className="text-sm font-medium mt-1">{formatBytes(selectedRun.bytes_transferred)}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-accent/50">
                    <p className="text-[11px] text-muted-foreground uppercase">Files</p>
                    <p className="text-sm font-medium mt-1">{selectedRun.files_transferred ?? 0}</p>
                  </div>
                </div>

                {/* Summary */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase mb-2">Summary</p>
                  <p className="text-sm">{selectedRun.short_summary}</p>
                </div>

                {/* Errors */}
                {selectedRun.errors_count > 0 && (
                  <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                    <p className="text-xs font-medium text-red-500 uppercase mb-1">
                      {selectedRun.errors_count} Error(s)
                    </p>
                  </div>
                )}

                {/* Log */}
                {selectedRun.log_excerpt && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                      <p className="text-xs font-medium text-muted-foreground uppercase">Log Output</p>
                    </div>
                    <ScrollArea className="h-48 rounded-lg border border-border bg-black/40 p-4">
                      <pre className="text-xs font-mono text-green-400 whitespace-pre-wrap">
                        {selectedRun.log_excerpt}
                      </pre>
                    </ScrollArea>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
