package desktopaccess

import (
	"context"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/viniciusbuscacio/pop-desktop-manager/internal/clidetect"
	"github.com/viniciusbuscacio/pop-desktop-manager/internal/localaccess"
	"github.com/viniciusbuscacio/pop-desktop-manager/internal/nodedetect"
)

// Controller makes Pop Desktop, rather than the installer/Manager, own the
// managed local-access process for exactly the lifetime of its web session.
type Controller struct {
	ctx        context.Context
	serverURL  string
	supervisor *localaccess.Supervisor

	mu         sync.Mutex
	token      string
	generation uint64
	starting   bool
	closed     bool
}

func New(ctx context.Context, serverURL string) *Controller {
	controller := &Controller{ctx: ctx, serverURL: serverURL}
	controller.supervisor = localaccess.New(controller.onEvent)
	return controller
}

func (c *Controller) SetSession(token string) {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return
	}
	c.token = token
	c.generation++
	generation := c.generation
	if token == "" {
		c.starting = false
		c.mu.Unlock()
		c.supervisor.Stop(5 * time.Second)
		return
	}
	if c.supervisor.Running() {
		c.mu.Unlock()
		if err := c.supervisor.UpdateToken(token); err != nil {
			fmt.Fprintln(os.Stderr, "pop-desktop: update local session:", err)
		}
		return
	}
	if c.starting {
		c.mu.Unlock()
		return
	}
	c.starting = true
	c.mu.Unlock()
	go c.start(generation)
}

func (c *Controller) Close() {
	c.mu.Lock()
	c.closed = true
	c.token = ""
	c.generation++
	c.starting = false
	c.mu.Unlock()
	c.supervisor.Stop(5 * time.Second)
}

func (c *Controller) start(generation uint64) {
	node := nodedetect.Detect(c.ctx)
	if node.Err != nil || node.Path == "" || !node.Compatible {
		c.finishStart(generation, "compatible Node was not found", node.Err)
		return
	}
	cli := clidetect.Detect(c.ctx, node.Path)
	if cli.Err != nil || cli.EntryPath == "" || !cli.ManagedLocalAccess {
		c.finishStart(generation, "compatible Pop CLI was not found", cli.Err)
		return
	}

	c.mu.Lock()
	if generation != c.generation || c.token == "" {
		token := c.token
		c.starting = false
		c.mu.Unlock()
		if token != "" {
			c.SetSession(token)
		}
		return
	}
	token := c.token
	c.mu.Unlock()
	err := c.supervisor.Start(c.ctx, localaccess.Config{
		NodePath: node.Path, EntryPath: cli.EntryPath, ServerURL: c.serverURL, Token: token,
	})
	c.mu.Lock()
	latest := c.token
	c.starting = false
	c.mu.Unlock()
	if err != nil {
		fmt.Fprintln(os.Stderr, "pop-desktop: start local access:", err)
		return
	}
	if latest == "" {
		c.supervisor.Stop(5 * time.Second)
	} else if latest != token {
		if err := c.supervisor.UpdateToken(latest); err != nil {
			fmt.Fprintln(os.Stderr, "pop-desktop: update local session after start:", err)
		}
	}
}

func (c *Controller) finishStart(generation uint64, message string, err error) {
	c.mu.Lock()
	if generation == c.generation {
		c.starting = false
	}
	c.mu.Unlock()
	if err == nil {
		fmt.Fprintln(os.Stderr, "pop-desktop:", message)
	} else {
		fmt.Fprintln(os.Stderr, "pop-desktop:", message+":", err)
	}
}

func (c *Controller) onEvent(event localaccess.Event) {
	if event.Kind != "stopped" && event.Kind != "fatal" && event.Kind != "auth_error" {
		return
	}
	// Wait for Supervisor.Wait to clear the old process before considering a
	// restart. Network loss is handled inside the TypeScript runtime itself.
	time.AfterFunc(250*time.Millisecond, func() {
		c.mu.Lock()
		token := c.token
		c.mu.Unlock()
		if token != "" && !c.supervisor.Running() {
			c.SetSession(token)
		}
	})
}
