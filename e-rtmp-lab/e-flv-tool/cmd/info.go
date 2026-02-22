package cmd

import (
	"eflv/flv"

	"github.com/spf13/cobra"
)

var (
	infoJSON    bool
	infoVerbose bool
)

var infoCmd = &cobra.Command{
	Use:   "info <input.flv>",
	Short: "Display structural information about an FLV / E-FLV file",
	Long: `Display structural information about an FLV / E-FLV file.

Includes:
  - Header info
  - Tag summary
  - Metadata/script data
  - Track information (if present)`,
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		return flv.InfoFLV(args[0], infoJSON, infoVerbose)
	},
}

func init() {
	infoCmd.Flags().BoolVar(&infoJSON, "json", false, "Output machine-readable JSON instead of text")
	infoCmd.Flags().BoolVar(&infoVerbose, "verbose", false, "Include lower-level details (offsets, timestamps, tag counts)")
	rootCmd.AddCommand(infoCmd)
}
