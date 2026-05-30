{
  description = "specforge — Mermaid stateDiagram-v2 to TLA+/CSPm formal verification targets";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};

        tla2toolsVersion = "v1.7.4";

        tla2tools = pkgs.fetchurl {
          url = "https://github.com/tlaplus/tlaplus/releases/download/${tla2toolsVersion}/tla2tools.jar";
          sha256 = "120f0lgd08vbp6l21zx0b9fw8ws5w8xm96k6zm6nj569c4h2cslk";
        };

        jdk = pkgs.jdk21;
      in
      {
        devShells.default = pkgs.mkShell {
          packages = [
            pkgs.deno
            jdk
          ];

          shellHook = ''
            export JAVA_HOME="${jdk.home}"
            export SPECFORGE_TLA_JAR="${tla2tools}"
            echo "specforge dev shell"
            echo "  deno: $(deno --version | head -n1)"
            echo "  java: $(java -version 2>&1 | head -n1)"
            echo "  SPECFORGE_TLA_JAR=$SPECFORGE_TLA_JAR (tla2tools ${tla2toolsVersion})"
          '';
        };

        packages.tla2tools = tla2tools;
      });
}
