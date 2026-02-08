"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Play,
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  FolderSync,
  Database,
  ImagePlus,
  Copy,
} from "lucide-react";
import { toast } from "sonner";
import type { Job, JobType } from "@/lib/types";

const jobTypeConfig: Record<JobType, { label: string; icon: React.ElementType; color: string }> = {
  rclone_copy: { label: "Rclone Copy", icon: Copy, color: "text-blue-500" },
  rclone_sync: { label: "Rclone Sync", icon: FolderSync, color: "text-indigo-500" },
  immich_db_backup: { label: "Immich DB Backup", icon: Database, color: "text-orange-500" },
  immich_go_import: { label: "Immich-go Import", icon: ImagePlus, color: "text-pink-500" },
};

const emptyJob: Partial<Job> = {
  name: "",
  type: "rclone_copy",
  enabled: 1,
  source_path: "",
  destination_path: "",
  schedule: "daily 02:00",
  flags: "",
  description: "",
};

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<Partial<Job>>(emptyJob);
  const [isEdit, setIsEdit] = useState(false);
  const [runningJobs, setRunningJobs] = useState<Set<number>>(new Set());

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/jobs");
      const data = await res.json();
      setJobs(data);
    } catch (e) {
      console.error("Failed to fetch jobs", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  const handleToggle = async (id: number) => {
    try {
      await fetch(`/api/jobs/${id}`, { method: "PATCH" });
      fetchJobs();
    } catch {
      toast.error("Failed to toggle job");
    }
  };

  const handleRunNow = async (id: number, name: string) => {
    try {
      setRunningJobs((prev) => new Set(prev).add(id));
      const res = await fetch(`/api/jobs/${id}/run`, { method: "POST" });
      const data = await res.json();
      toast.success(data.message || `Job "${name}" started`);
      // Auto-refresh after simulated execution
      setTimeout(() => {
        setRunningJobs((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        fetchJobs();
      }, 8000);
    } catch {
      toast.error("Failed to start job");
      setRunningJobs((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Delete job "${name}"? This will also delete all run history.`)) return;
    try {
      await fetch(`/api/jobs/${id}`, { method: "DELETE" });
      toast.success(`Job "${name}" deleted`);
      fetchJobs();
    } catch {
      toast.error("Failed to delete job");
    }
  };

  const openCreate = () => {
    setEditingJob({ ...emptyJob });
    setIsEdit(false);
    setDialogOpen(true);
  };

  const openEdit = (job: Job) => {
    setEditingJob({ ...job });
    setIsEdit(true);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    try {
      if (isEdit && editingJob.id) {
        await fetch(`/api/jobs/${editingJob.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(editingJob),
        });
        toast.success("Job updated");
      } else {
        await fetch("/api/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(editingJob),
        });
        toast.success("Job created");
      }
      setDialogOpen(false);
      fetchJobs();
    } catch {
      toast.error("Failed to save job");
    }
  };

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Backup Jobs</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your backup and import jobs
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchJobs}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="w-4 h-4 mr-2" />
            New Job
          </Button>
        </div>
      </div>

      {/* Jobs Grid */}
      <div className="grid gap-4 md:grid-cols-2">
        {jobs.map((job) => {
          const cfg = jobTypeConfig[job.type] || jobTypeConfig.rclone_copy;
          const Icon = cfg.icon;
          const isRunning = runningJobs.has(job.id);

          return (
            <Card key={job.id} className={`relative transition-all ${!job.enabled ? "opacity-60" : ""}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center bg-accent`}>
                      <Icon className={`w-4 h-4 ${cfg.color}`} />
                    </div>
                    <div className="min-w-0">
                      <CardTitle className="text-sm truncate">{job.name}</CardTitle>
                      <Badge variant="outline" className="text-[10px] mt-1">{cfg.label}</Badge>
                    </div>
                  </div>
                  <Switch
                    checked={!!job.enabled}
                    onCheckedChange={() => handleToggle(job.id)}
                  />
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {job.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2">{job.description}</p>
                )}
                <div className="space-y-1.5 text-xs">
                  <div className="flex gap-2">
                    <span className="text-muted-foreground w-20 flex-shrink-0">Source:</span>
                    <span className="font-mono truncate">{job.source_path}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-muted-foreground w-20 flex-shrink-0">Destination:</span>
                    <span className="font-mono truncate">{job.destination_path}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-muted-foreground w-20 flex-shrink-0">Schedule:</span>
                    <span>{job.schedule}</span>
                  </div>
                  {job.flags && (
                    <div className="flex gap-2">
                      <span className="text-muted-foreground w-20 flex-shrink-0">Flags:</span>
                      <span className="font-mono text-[11px] truncate">{job.flags}</span>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 pt-2 border-t border-border/50">
                  <Button
                    variant="default"
                    size="sm"
                    className="flex-1"
                    disabled={isRunning || !job.enabled}
                    onClick={() => handleRunNow(job.id, job.name)}
                  >
                    {isRunning ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                        Running...
                      </>
                    ) : (
                      <>
                        <Play className="w-3.5 h-3.5 mr-1.5" />
                        Run Now
                      </>
                    )}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => openEdit(job)}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => handleDelete(job.id, job.name)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {jobs.length === 0 && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No jobs yet. Create your first backup job!</p>
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit Job" : "Create New Job"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="name">Job Name</Label>
              <Input
                id="name"
                value={editingJob.name || ""}
                onChange={(e) => setEditingJob({ ...editingJob, name: e.target.value })}
                placeholder="e.g. Nextcloud Datadir → Google Drive"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="type">Job Type</Label>
              <Select
                value={editingJob.type || "rclone_copy"}
                onValueChange={(v) => setEditingJob({ ...editingJob, type: v as JobType })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="rclone_copy">Rclone Copy</SelectItem>
                  <SelectItem value="rclone_sync">Rclone Sync</SelectItem>
                  <SelectItem value="immich_db_backup">Immich DB Backup</SelectItem>
                  <SelectItem value="immich_go_import">Immich-go Import</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="source">Source Path</Label>
              <Input
                id="source"
                value={editingJob.source_path || ""}
                onChange={(e) => setEditingJob({ ...editingJob, source_path: e.target.value })}
                placeholder="/mnt/toshiba/nextcloud-data"
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dest">Destination Path</Label>
              <Input
                id="dest"
                value={editingJob.destination_path || ""}
                onChange={(e) => setEditingJob({ ...editingJob, destination_path: e.target.value })}
                placeholder="gdrive:backups/nextcloud"
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="schedule">Schedule</Label>
              <Input
                id="schedule"
                value={editingJob.schedule || ""}
                onChange={(e) => setEditingJob({ ...editingJob, schedule: e.target.value })}
                placeholder="daily 02:00"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="flags">Flags (optional)</Label>
              <Input
                id="flags"
                value={editingJob.flags || ""}
                onChange={(e) => setEditingJob({ ...editingJob, flags: e.target.value })}
                placeholder="--checksum --transfers 4"
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={editingJob.description || ""}
                onChange={(e) => setEditingJob({ ...editingJob, description: e.target.value })}
                placeholder="Describe what this job does..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>
              {isEdit ? "Save Changes" : "Create Job"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
