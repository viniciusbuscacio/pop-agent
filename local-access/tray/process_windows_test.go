//go:build windows

package main

import (
	"context"
	"golang.org/x/sys/windows"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestProcessTreeHelper(t *testing.T) {
	mode := os.Getenv("POP_TREE_TEST_HELPER")
	if mode == "" {
		return
	}
	if mode == "parent" {
		child := exec.Command(os.Args[0], "-test.run=^TestProcessTreeHelper$")
		child.Env = append(os.Environ(), "POP_TREE_TEST_HELPER=child")
		if err := child.Start(); err != nil {
			os.Exit(2)
		}
		if err := os.WriteFile(os.Getenv("POP_TREE_TEST_PID"), []byte(strconv.Itoa(child.Process.Pid)), 0600); err != nil {
			os.Exit(3)
		}
	}
	time.Sleep(time.Minute)
	os.Exit(0)
}

func TestChildTreeTermination(t *testing.T) {
	for _, mode := range []string{"stop", "cancel"} {
		t.Run(mode, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			pidFile := filepath.Join(t.TempDir(), "child.pid")
			cmd := childCommand(ctx, os.Args[0], "-test.run=^TestProcessTreeHelper$")
			cmd.Env = append(os.Environ(), "POP_TREE_TEST_HELPER=parent", "POP_TREE_TEST_PID="+pidFile)
			cmd.SysProcAttr = childProcessAttributes()
			if err := cmd.Start(); err != nil {
				t.Fatal(err)
			}
			defer terminateChild(cmd)
			var data []byte
			deadline := time.Now().Add(10 * time.Second)
			for time.Now().Before(deadline) {
				data, _ = os.ReadFile(pidFile)
				if len(data) > 0 {
					break
				}
				time.Sleep(20 * time.Millisecond)
			}
			pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
			if err != nil {
				t.Fatal("helper did not start", err)
			}
			handle, err := windows.OpenProcess(windows.SYNCHRONIZE|windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
			if err != nil {
				t.Fatal(err)
			}
			defer windows.CloseHandle(handle)
			if mode == "stop" {
				terminateChild(cmd)
				cancel()
			} else {
				cancel()
			}
			_ = cmd.Wait()
			result, err := windows.WaitForSingleObject(handle, 5000)
			if err != nil || result != windows.WAIT_OBJECT_0 {
				t.Fatalf("descendant survived %s: result=%d err=%v", mode, result, err)
			}
		})
	}
}
