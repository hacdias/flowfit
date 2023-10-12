import ArgumentParser

struct Converter: ParsableCommand {
    @Option(name: .shortAndLong, help: "The amount of calories to add to the workout.")
    var calories: UInt16? = nil
    
    @Option(name: .shortAndLong, help: "The name of the output FIT file.")
    var output: String = "output.fit"
    
    @Argument(help: "The FIT file exported from eBike Flow.")
    var input: String

    mutating func run() throws {
        try convert(input: input, output: output, calories: calories)
        print("Output file written to \(output)!")
    }
}

Converter.main()
