use std::collections::HashMap;

mod utils;

trait Speak {
    fn speak(&self) -> String;
}

struct Dog {
    name: String,
    age: u32,
}

enum Color {
    Red,
    Blue,
    Green,
}

impl Speak for Dog {
    fn speak(&self) -> String {
        format!("Woof from {}", self.name)
    }
}

impl Dog {
    fn new(name: String) -> Self {
        Dog { name, age: 0 }
    }
}

fn greet(name: &str) -> String {
    format!("Hello {}", name)
}

fn main() {
    let d = Dog::new("Rex".to_string());
    println!("{}", d.speak());
    let _count: i32 = 5;
}
