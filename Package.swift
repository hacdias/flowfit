// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "flowfit",
    platforms: [
        .macOS(.v10_15)
    ],
    dependencies: [
        .package(url: "https://github.com/apple/swift-argument-parser", .upToNextMajor(from: "1.2.3")),
        .package(url: "https://github.com/garmin/fit-objective-c-sdk", .upToNextMajor(from: "21.115.0")),
    ],
    targets: [
        .executableTarget(name: "flowfit", dependencies: [
            .product(name: "ArgumentParser", package: "swift-argument-parser"),
            .product(name: "FIT", package: "fit-objective-c-sdk"),
        ]),
    ]
)
