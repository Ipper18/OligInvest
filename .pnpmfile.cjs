// Better Auth is used only through its server/Drizzle exports. pnpm 12.4.2
// resolves optional peers from the workspace, shipping generators and test
// runners in the API image. Keep those packages in their own dev workspaces.
module.exports = {
  hooks: {
    readPackage(pkg) {
      if (pkg.name === "better-auth" && pkg.version === "1.7.5") {
        for (const name of ["drizzle-kit", "vitest", "next", "react", "react-dom"]) {
          if (pkg.peerDependenciesMeta?.[name]?.optional !== true)
            throw new Error(`Expected optional Better Auth peer: ${name}`);
          delete pkg.peerDependencies[name];
          delete pkg.peerDependenciesMeta[name];
        }
      }
      return pkg;
    },
  },
};
