package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

type savedFile struct {
	path   string
	data   []byte
	exists bool
}

func snapshotFiles(paths []string) ([]savedFile, error) {
	out := make([]savedFile, 0, len(paths))
	for _, path := range paths {
		info, err := os.Lstat(path)
		if os.IsNotExist(err) {
			out = append(out, savedFile{path: path})
			continue
		}
		if err != nil || !info.Mode().IsRegular() || info.Size() > 128<<20 {
			return nil, errors.New("An installation target is not a bounded regular file.")
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		out = append(out, savedFile{path: path, data: data, exists: true})
	}
	return out, nil
}

func backupFiles(files []savedFile, directory string) error {
	for i, file := range files {
		if file.exists {
			if err := atomicFile(filepath.Join(directory, fmt.Sprintf("%d.exe", i)), file.data, 0700); err != nil {
				return err
			}
		}
	}
	// Program paths only: backups never contain profiles or credentials.
	var index string
	for i, file := range files {
		if file.exists {
			index += fmt.Sprintf("%d.exe: %s\n", i, file.path)
		}
	}
	return atomicFile(filepath.Join(directory, "files.txt"), []byte(index), 0600)
}

func restoreFiles(files []savedFile) error {
	var failures []error
	for _, file := range files {
		var err error
		if file.exists {
			err = atomicFile(file.path, file.data, 0700)
		} else {
			err = os.Remove(file.path)
			if os.IsNotExist(err) {
				err = nil
			}
		}
		if err != nil {
			failures = append(failures, fmt.Errorf("restore %s: %w", filepath.Base(file.path), err))
		}
	}
	return errors.Join(failures...)
}
