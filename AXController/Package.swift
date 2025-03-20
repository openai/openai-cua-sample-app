// swift-tools-version:5.5
import PackageDescription

let package = Package(
    name: "AXController",
    platforms: [
        .macOS(.v10_15)
    ],
    products: [
        .executable(name: "AXController", targets: ["AXController"])
    ],
    dependencies: [],
    targets: [
        .executableTarget(
            name: "AXController",
            dependencies: [],
            path: "Sources",
            swiftSettings: [
                .unsafeFlags(["-Xfrontend", "-disable-debugger-shadow-copies"])
            ]
        )
    ]
) 