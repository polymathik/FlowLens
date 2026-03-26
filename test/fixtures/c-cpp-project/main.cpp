#include <iostream>
#include <string>

namespace animals {

class Animal {
public:
    virtual std::string speak() = 0;
    virtual ~Animal() {}
protected:
    std::string name;
};

class Dog : public Animal {
public:
    Dog(const std::string& n) { name = n; }
    std::string speak() override { return "Woof"; }
    void fetch() { auto a = new Animal(); }
private:
    int age;
};

} // namespace animals

int main() {
    animals::Dog d("Rex");
    std::cout << d.speak() << std::endl;
    return 0;
}
