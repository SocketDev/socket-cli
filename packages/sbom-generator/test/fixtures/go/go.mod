module github.com/example/test-go-app

go 1.21

require (
	github.com/spf13/cobra v1.7.0
	github.com/spf13/viper v1.16.0
	gopkg.in/yaml.v3 v3.0.1
	github.com/pkg/errors v0.9.1 // indirect
)

require (
	github.com/fsnotify/fsnotify v1.6.0 // indirect
	github.com/hashicorp/hcl v1.0.0 // indirect
)

replace github.com/old/module => github.com/new/module v1.2.3
