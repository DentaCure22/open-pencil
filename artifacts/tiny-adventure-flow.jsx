<Frame name="Tiny Adventure Flow" w={1600} h={900} flex="col" gap={28} p={56} bg="#FBFAF7" rounded={28}>
  <Frame name="Flow Header" w="fill" h="hug" flex="row" justify="between" items="end">
    <Frame name="Title Group" w="hug" h="hug" flex="col" gap={10}>
      <Text name="Eyebrow" size={13} weight={700} color="#E15B3D">PLAYFUL DECISION FLOW</Text>
      <Text name="Title" size={44} weight={700} color="#24221F">Choose your tiny adventure</Text>
      <Text name="Subtitle" size={18} weight={400} color="#77716A">Follow your mood. Keep it small. Make it memorable.</Text>
    </Frame>
    <Frame name="Flow Key" w="hug" h="hug" flex="row" gap={10} items="center" px={18} py={12} bg="#FFFFFF" stroke="#E7E2DB" strokeWidth={1} rounded={999}>
      <Ellipse name="Coral Dot" w={10} h={10} bg="#FF775C" />
      <Text size={13} weight={600} color="#625D57">7 stops</Text>
      <Text size={13} weight={400} color="#AAA39B">·</Text>
      <Ellipse name="Green Dot" w={10} h={10} bg="#45AE77" />
      <Text size={13} weight={600} color="#625D57">1 good story</Text>
    </Frame>
  </Frame>

  <Frame name="Flow Stage" w="fill" h="fill" flex="row" gap={16} items="center" justify="center">
    <Frame name="01 Start" w={188} h={126} flex="col" gap={10} p={18} justify="center" bg="#FFF2ED" stroke="#FFBEAF" strokeWidth={1} rounded={22}>
      <Frame w="hug" h="hug" flex="row" gap={8} items="center">
        <Ellipse w={9} h={9} bg="#FF775C" />
        <Text size={12} weight={700} color="#B8432B">START</Text>
      </Frame>
      <Text name="Start Label" w={152} h={48} textAutoResize="none" size={20} weight={700} color="#342B27">Free hour appears</Text>
    </Frame>

    <Text name="Arrow 1" size={30} weight={400} color="#B9B1A8">→</Text>

    <Frame name="02 Decision" w={202} h={150} flex="col" gap={12} p={22} justify="center" bg="#2F2B27" rounded={28} shadow="0 10 26 #00000018">
      <Text size={12} weight={700} color="#FFB8A8">PICK A MOOD</Text>
      <Text name="Decision Label" w={158} h={58} textAutoResize="none" size={23} weight={700} color="#FFFFFF">What sounds good?</Text>
      <Text size={13} weight={400} color="#CFC8C1">No wrong answer.</Text>
    </Frame>

    <Text name="Arrow 2" size={30} weight={400} color="#B9B1A8">→</Text>

    <Frame name="03 Two Moods" w={222} h="hug" flex="col" gap={14}>
      <Frame name="03A Wander" w={222} h={112} flex="col" gap={10} p={18} justify="center" bg="#FFF5C8" stroke="#EAD66C" strokeWidth={1} rounded={20}>
        <Text size={12} weight={700} color="#8A6A00">WANDER</Text>
        <Text name="Wander Label" w={186} h={30} textAutoResize="none" size={19} weight={700} color="#3B3420">Find something odd</Text>
      </Frame>
      <Frame name="03B Create" w={222} h={112} flex="col" gap={10} p={18} justify="center" bg="#EEEAFE" stroke="#C7BAF6" strokeWidth={1} rounded={20}>
        <Text size={12} weight={700} color="#6551B7">CREATE</Text>
        <Text name="Create Label" w={186} h={50} textAutoResize="none" size={19} weight={700} color="#30294A">Make a tiny masterpiece</Text>
      </Frame>
    </Frame>

    <Text name="Arrow 3" size={30} weight={400} color="#B9B1A8">→</Text>

    <Frame name="04 Reward" w={174} h={118} flex="col" gap={12} p={20} justify="center" bg="#EAF8F0" stroke="#A8DFC1" strokeWidth={1} rounded={22}>
      <Text size={12} weight={700} color="#237A4A">REWARD</Text>
      <Text name="Reward Label" w={134} h={30} textAutoResize="none" size={20} weight={700} color="#234333">Grab a treat</Text>
    </Frame>

    <Text name="Arrow 4" size={30} weight={400} color="#B9B1A8">→</Text>

    <Frame name="05 Share" w={174} h={118} flex="col" gap={12} p={20} justify="center" bg="#EAF3FF" stroke="#B8D2F1" strokeWidth={1} rounded={22}>
      <Text size={12} weight={700} color="#356A9B">SHARE</Text>
      <Text name="Share Label" w={134} h={48} textAutoResize="none" size={20} weight={700} color="#263D52">Tell the story</Text>
    </Frame>

    <Text name="Arrow 5" size={30} weight={400} color="#B9B1A8">→</Text>

    <Frame name="06 Finish" w={206} h={150} flex="col" gap={12} p={22} justify="center" bg="#FF775C" rounded={28}>
      <Text size={12} weight={700} color="#FFE2DA">TINY WIN</Text>
      <Text name="Finish Label" w={162} h={32} textAutoResize="none" size={23} weight={700} color="#FFFFFF">Day upgraded</Text>
      <Text size={13} weight={500} color="#FFF1ED">Do it again soon.</Text>
    </Frame>
  </Frame>

  <Frame name="Branch Notes" w="fill" h="hug" flex="row" justify="center" gap={18}>
    <Frame w="hug" h="hug" flex="row" gap={8} items="center" px={14} py={9} bg="#FFF5C8" rounded={999}>
      <Ellipse w={7} h={7} bg="#C89B00" />
      <Text size={12} weight={600} color="#6F5709">Go out and notice</Text>
    </Frame>
    <Frame w="hug" h="hug" flex="row" gap={8} items="center" px={14} py={9} bg="#EEEAFE" rounded={999}>
      <Ellipse w={7} h={7} bg="#8069D4" />
      <Text size={12} weight={600} color="#55449A">Stay in and make</Text>
    </Frame>
  </Frame>
</Frame>
